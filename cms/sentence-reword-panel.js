/**
 * sentence-reword-panel.js
 *
 * Plugs into the existing "⚙ Manage" screen as a new panel. Shows entities
 * with a sentence_reword item in status "awaiting_review", lets Tom see
 * each proposed sentence before/after, and resolves with one of three
 * actions:
 *
 *   Cancel        — discard the proposal. Nothing in data.json changes.
 *   Approve       — merge accepted sentences into data.json, purge audio.
 *   Approve & Record — same merge + purge, and queue the entity for a
 *                       fresh TTS pass.
 *
 * INTEGRATION NOTE: this file does not know how your app talks to GitHub —
 * that already exists (the "Save to GitHub" button in Manage). Wire the
 * four functions in `hostBindings` below to your existing implementation:
 *
 *   getFile(path)              -> Promise<string>  raw file contents
 *   putFile(path, content, msg)-> Promise<void>     commit a file update
 *   deleteFile(path, msg)      -> Promise<void>     commit a file deletion
 *   listAudioFiles()           -> Promise<string[]> paths under AUDIO_DIR
 *
 * If your repo's audio files live somewhere other than the flat "audio/"
 * root assumed by AUDIO_DIR below, change that one constant.
 */

const DATA_PATH = "data.json";
const QUEUE_PATH = "workQueue.sentenceReword.json";
const TTS_QUEUE_PATH = "workQueue.tts.json";
const AUDIO_DIR = "audio"; // adjust to match the actual repo layout
const MAX_WORDS = 40;

export function createSentenceRewordPanel(hostBindings) {
  const { getFile, putFile, deleteFile, listAudioFiles } = hostBindings;

  async function loadQueue() {
    return JSON.parse(await getFile(QUEUE_PATH));
  }
  async function saveQueue(queue, message) {
    await putFile(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n", message);
  }
  async function loadData() {
    return JSON.parse(await getFile(DATA_PATH));
  }
  async function saveData(data, message) {
    await putFile(DATA_PATH, JSON.stringify(data, null, 2) + "\n", message);
  }

  function wordCount(sentence) {
    return sentence.trim().split(/\s+/).filter(Boolean).length;
  }

  /** Returns items awaiting human review, newest first. */
  async function getPendingItems() {
    const queue = await loadQueue();
    return queue.items
      .filter((i) => i.status === "awaiting_review")
      .sort((a, b) => (b.queuedAt || "").localeCompare(a.queuedAt || ""));
  }

  /**
   * Renders one item's before/after pairs as plain data the UI layer can
   * turn into HTML however matches the app's existing style (gold/navy,
   * per the timeline's look). Each pair gets its own accept/reject state,
   * defaulting to accepted; flags any "after" sentence that still exceeds
   * the word limit so a bad proposal is visible before approving.
   */
  function toReviewRows(item) {
    const pairs = (item.result && item.result.pairs) || [];
    return pairs.map((p, idx) => ({
      idx,
      sectionIndex: p.sectionIndex,
      before: p.before,
      after: p.after,
      accepted: true,
      warning: p.after
        .split(/(?<=[.?!])\s+/)
        .some((s) => wordCount(s) > MAX_WORDS)
        ? `A resulting sentence is still over ${MAX_WORDS} words — check before approving.`
        : null,
    }));
  }

  /** Cancel — discard, no data.json change. */
  async function handleCancel(item) {
    const queue = await loadQueue();
    const target = queue.items.find((i) => i.id === item.id);
    target.status = "cancelled";
    await saveQueue(queue, `Reword cancelled: ${item.entityId}`);
  }

  /**
   * Splices each accepted "after" in place of its verbatim "before" match
   * inside the correct section's body. Matching is substring-based on the
   * exact text, same discipline as the patches `article` mechanism —
   * unmatched text is reported, never silently skipped.
   */
  function applyPairsToEntity(entity, acceptedRows) {
    const notApplied = [];
    for (const row of acceptedRows) {
      const section = entity.art.sections[row.sectionIndex];
      if (!section) {
        notApplied.push(row);
        continue;
      }
      if (!section.b.includes(row.before)) {
        notApplied.push(row);
        continue;
      }
      section.b = section.b.replace(row.before, row.after);
    }
    return notApplied;
  }

  async function purgeAudio(entity) {
    entity.audio = "";
    const allAudioFiles = await listAudioFiles();
    const prefix = `${entity.id}-v`;
    const matches = allAudioFiles.filter((path) => {
      const filename = path.split("/").pop();
      return filename.startsWith(prefix) && (filename.endsWith(".mp3") || filename.endsWith(".json"));
    });
    for (const path of matches) {
      await deleteFile(path, `Purge stale audio for ${entity.id} (reworded)`);
    }
    return matches;
  }

  /**
   * Approve — merge + purge. Pass alsoRecord: true for "Approve & Record".
   * acceptedRows should be the review rows with accepted === true only
   * (caller filters based on checkbox state in the UI).
   */
  async function handleApprove(item, acceptedRows, { alsoRecord } = {}) {
    const data = await loadData();
    const entity = data.entries.find((e) => e.id === item.entityId);
    if (!entity) throw new Error(`Entity ${item.entityId} not found in data.json`);

    const notApplied = applyPairsToEntity(entity, acceptedRows);
    const purgedFiles = await purgeAudio(entity);

    await saveData(
      data,
      `Reword ${item.entityId}: ${acceptedRows.length - notApplied.length} sentence(s) split, audio purged`
    );

    const queue = await loadQueue();
    const target = queue.items.find((i) => i.id === item.id);
    target.status = "done";
    if (notApplied.length) {
      target.error = `${notApplied.length} pair(s) could not be matched verbatim and were skipped`;
    }
    await saveQueue(queue, `Reword resolved: ${item.entityId}`);

    if (alsoRecord) {
      let ttsQueue;
      try {
        ttsQueue = JSON.parse(await getFile(TTS_QUEUE_PATH));
      } catch {
        ttsQueue = { v: 1, items: [] };
      }
      ttsQueue.items.push({
        id: `tts-${item.entityId}-${Date.now()}`,
        entityId: item.entityId,
        workflowType: "tts",
        status: "queued",
        runId: null,
        payload: {},
        result: null,
        provider: null,
        tokensUsed: 0,
        error: null,
        queuedAt: new Date().toISOString(),
      });
      await putFile(TTS_QUEUE_PATH, JSON.stringify(ttsQueue, null, 2) + "\n", `Queue TTS: ${item.entityId}`);
    }

    return { notApplied, purgedFiles };
  }

  return { getPendingItems, toReviewRows, handleCancel, handleApprove };
}
