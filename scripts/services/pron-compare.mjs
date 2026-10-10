// pron-compare.mjs (2026-10-07) — the app's own sound converters, copied verbatim from index.html
// v563 so the recorder compares pronunciations exactly the way the pronunciation view does:
//   lpGuideOf(ipa)      Kokoro's sounds -> simple respelling ("vˈYtɪwɑ" -> "VOY-tih-wah")
//   lpRespell(respell)  respelling -> Kokoro's sounds (what "Type it" saves as kokoro_ipa)
// soundKey() is the view's "same sound?" key (v538), plus one tolerance for automatic voting:
// unstressed uh / ih / schwa count as the same sound, so a vote only overrides Kokoro for a real
// difference (stress, a stressed vowel, a consonant), not "BAP-tuhst" vs "BAP-tihst".

const lpGuideOf = (function(){
const P2R_V = [['eɪ','ay'],['aɪ','eye'],['aʊ','ow'],['oʊ','oh'],['ɔɪ','oy'],['əʊ','oh'],['ɜɹ','er'],['ɜː','er'],['ɑɹ','ar'],['ɔɹ','or'],
  ['ɛɹ','air'],['eə','air'],['ɪɹ','eer'],['ɪə','eer'],['ʊɹ','oor'],['ɚ','er'],['A','ay'],['I','eye'],['W','ow'],['O','oh'],['Y','oy'],
  ['Q','oh'],['i','ee'],['ɪ','ih'],['ᵻ','ih'],['ɛ','eh'],['e','ay'],['æ','a'],['a','ah'],['ɑ','ah'],['ɒ','ah'],['ɔ','aw'],['o','oh'],
  ['ʊ','uu'],['u','oo'],['ʌ','uh'],['ə','uh'],['ᵊ','uh'],['ɐ','uh'],['ɜ','er'],['ɨ','ih'],['y','oo'],['ø','er'],['œ','eh'],['ɯ','oo']];
const P2R_C = { 'θ':'th','ð':'th','ʃ':'sh','ʒ':'zh','ʧ':'ch','ʤ':'j','ŋ':'ng','ɡ':'g','g':'g','ɹ':'r','r':'r','ɾ':'t','j':'y','ʔ':'',
  'x':'k','ç':'h','ʁ':'r','ɲ':'ny','ʎ':'ly','ɫ':'l','ɬ':'l','β':'b','ɣ':'g','χ':'h','ʂ':'sh','ʐ':'zh','ɕ':'sh','ʑ':'zh' };
function guideOf(ph){
  // v8: several words ("ɡˈɑdz wˈɪl") are shown word by word, with a space between.
  const words = String(ph || '').trim().split(/\s+/).filter(Boolean);
  if(words.length > 1) return words.map(guideOfWord).join(' ');
  return guideOfWord(words[0] || '');
}
function guideOfWord(ph){
  const src = String(ph || '').replace(/[ː\s]/g, '').replace(/ˌ/g, '');
  const items = []; let stressNext = false, i = 0;
  while(i < src.length){
    if(src[i] === 'ˈ'){ stressNext = true; i++; continue; }
    let v = null;
    for(const [u, r] of P2R_V){ if(src.startsWith(u, i)){ v = { t: r, v: true, len: u.length, eye: r === 'eye' }; break; } }
    if(v){ v.stress = stressNext; stressNext = false; items.push(v); i += v.len; continue; }
    const ch = src[i]; const r = P2R_C[ch] !== undefined ? P2R_C[ch] : (/[a-z]/.test(ch) ? ch : '');
    items.push({ t: r, v: false }); i++;
  }
  const vi = items.map((x, k) => x.v ? k : -1).filter(k => k >= 0);
  if(!vi.length) return items.map(x => x.t).join('');
  // Split between vowels: a lone consonant starts the next part; of two or more, the first stays behind.
  const cuts = [];
  for(let k = 1; k < vi.length; k++){
    const between = vi[k] - vi[k - 1] - 1;
    cuts.push(between <= 1 ? vi[k] - between : vi[k - 1] + 2);
  }
  const bounds = [0].concat(cuts, [items.length]), sylls = [];
  for(let k = 0; k < bounds.length - 1; k++){
    const seg = items.slice(bounds[k], bounds[k + 1]);
    const vk = seg.findIndex(x => x.v);
    let txt = '';
    seg.forEach((x, n) => {
      if(n === vk && x.eye){
        const onset = seg.slice(0, n).map(y => y.t).join(''), coda = seg.slice(n + 1).map(y => y.t).join('');
        if(onset){ txt = onset + 'y' + (coda ? coda + 'e' : 'e'); return; }
      }
      if(vk >= 0 && seg[vk].eye && seg.slice(0, vk).some(y => y.t) && n !== vk) return;
      txt += x.t;
    });
    sylls.push(vk >= 0 && seg[vk].stress ? txt.toUpperCase() : txt);
  }
  return sylls.join('-');
}

  return guideOf;
})();

const lpRespell = (function(){
const R2P_V = [ // spelling, stressed sound, unstressed sound (longest spellings first)
  ['eye','I','I'],['igh','I','I'],['air','ɛɹ','ɛɹ'],['eer','ɪɹ','ɪɹ'],['ear','ɪɹ','ɪɹ'],['oor','ʊɹ','ʊɹ'],['uu','ʊ','ʊ'],
  ['ay','A','A'],['ai','A','A'],['ee','i','i'],['ea','i','i'],['oo','u','u'],['ew','ju','ju'],['ou','W','W'],['ow','W','W'],
  ['oh','O','O'],['oa','O','O'],['oy','Y','Y'],['oi','Y','Y'],['aw','ɔ','ɔ'],['au','ɔ','ɔ'],['ah','ɑ','ɑ'],['uh','ʌ','ə'],
  ['ih','ɪ','ɪ'],['eh','ɛ','ɛ'],['er','ɜɹ','əɹ'],['ur','ɜɹ','əɹ'],['ir','ɜɹ','əɹ'],['ar','ɑɹ','ɑɹ'],['or','ɔɹ','ɔɹ'],
  ['a','æ','æ'],['e','ɛ','ɛ'],['i','ɪ','ɪ'],['o','ɑ','ɑ'],['u','ʌ','ə']
];
const R2P_C = [['tch','ʧ'],['ch','ʧ'],['sh','ʃ'],['zh','ʒ'],['th','θ'],['dh','ð'],['ng','ŋ'],['ph','f'],['ck','k'],['qu','kw'],
  ['wh','w'],['kh','k'],['j','ʤ'],['g','ɡ'],['c','k'],['x','ks'],['r','ɹ'],['b','b'],['d','d'],['f','f'],['h','h'],['k','k'],
  ['l','l'],['m','m'],['n','n'],['p','p'],['s','s'],['t','t'],['v','v'],['w','w'],['z','z']];
const LONG = { a: 'ay', i: 'eye', y: 'eye', o: 'oh', u: 'oo' };
function respellPart(part, stressed){
  let p = part.toLowerCase().replace(/[^a-z]/g, '');
  // Silent e: "vyte", "kite" -> long vowel ("vyte" = v + eye + t).
  const m = p.match(/^(.*?)([aiouy])(ch|sh|th|[bcdfgjklmnpstvz])e$/);
  if(m && !/[aeiouy]$/.test(m[1])) p = m[1] + LONG[m[2]] + m[3];
  let out = '', stressPut = false, i = 0;
  while(i < p.length){
    let hit = null;
    const isVowelAt = (k) => /[aeiou]/.test(p[k] || '');
    if(p[i] === 'y'){
      if(i > 0 && p[i + 1] === 'e' && !isVowelAt(i + 2) && p[i + 2] !== 'h'){ hit = { len: 2, ph: 'I', v: true }; }   // "tye", "pye" (but "nyeh" = n + y + eh)
      else if(i === 0 || isVowelAt(i + 1)){ hit = { len: 1, ph: 'j', v: false }; }                          // "yoo", "yes"
      else hit = { len: 1, ph: (i === p.length - 1 ? 'i' : 'ɪ'), v: true };                                 // "SIN-y"
    }
    if(!hit) for(const [sp, st, un] of R2P_V){ if(p.startsWith(sp, i)){ hit = { len: sp.length, ph: stressed ? st : un, v: true }; break; } }
    if(!hit) for(const [sp, ph] of R2P_C){ if(p.startsWith(sp, i)){ hit = { len: sp.length, ph, v: false }; break; } }
    if(!hit){ i++; continue; }
    if(hit.v && stressed && !stressPut){ out += 'ˈ'; stressPut = true; }
    out += hit.ph; i += hit.len;
  }
  return out;
}
function guideToPhonemes(txt){
  // v8: a space separates WORDS ("GODZ WIL"); each word gets its own stress and keeps its own
  // sounds, joined by a space. Hyphens separate syllables inside one word ("KRAH-koof").
  const words = String(txt || '').trim().split(/\s+/).map(guideWordToPhonemes).filter(Boolean);
  return words.join(' ');
}
function guideWordToPhonemes(word){
  const parts = String(word || '').split(/[-\u2010-\u2014]+/).filter(x => /[a-z]/i.test(x));
  if(!parts.length) return '';
  let stressAt = parts.findIndex(x => /[A-Z]/.test(x) && x === x.toUpperCase());
  if(stressAt < 0) stressAt = 0;
  // Doubled consonants across parts ("MES-suh") are one sound.
  return parts.map((x, k) => respellPart(x, k === stressAt)).join('').replace(/([bdfhklmnpstvwzɡɹʃʒθðŋʧʤ])\1/g, '$1');
}
  return guideToPhonemes;
})();

export { lpGuideOf, lpRespell };

const VOWELS = new Set(['a','e','i','o','u','A','I','O','W','Y','Q','æ','ɑ','ɒ','ɔ','ə','ɚ','ɛ','ɜ','ɪ','ʊ','ʌ','ɐ','ᵻ','ᵊ','ɨ','y','ø','œ','ɯ']);
const REDUCED = new Set(['ə','ɪ','ʌ','ɐ','ᵻ','ᵊ','ɨ']);
// Sound key of a respelling (as the view compares them), with unstressed reduced vowels merged.
export function soundKey(respell){
  let k;
  try{ k = lpRespell(String(respell || '')).replace(/[\sˌ]/g, ''); }catch(e){ return String(respell || '').toLowerCase(); }
  let out = '', stressNext = false;
  const chars = [...k];
  chars.forEach((ch, i) => {
    if(ch === 'ˈ'){ stressNext = true; out += ch; return; }
    if(VOWELS.has(ch)){
      // unstressed uh/ih/schwa are one sound; so is an unstressed "ah" ending the word (-wah / -wuh)
      const last = i === chars.length - 1;
      out += (!stressNext && (REDUCED.has(ch) || (last && ch === 'ɑ'))) ? 'ə' : ch;
      stressNext = false;
      return;
    }
    out += ch;
  });
  return out;
}
// Kokoro's reading (its sounds) -> the same kind of key, through the same respelling step.
export function kokoroKey(ipa){ try{ return soundKey(lpGuideOf(ipa)); }catch(e){ return ''; } }
