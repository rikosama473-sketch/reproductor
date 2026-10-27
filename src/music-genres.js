export const ID3_V1_GENRES = Object.freeze([
  "Blues", "Classic Rock", "Country", "Dance", "Disco", "Funk", "Grunge", "Hip-Hop",
  "Jazz", "Metal", "New Age", "Oldies", "Other", "Pop", "R&B", "Rap", "Reggae",
  "Rock", "Techno", "Industrial", "Alternative", "Ska", "Death Metal", "Pranks",
  "Soundtrack", "Euro-Techno", "Ambient", "Trip-Hop", "Vocal", "Jazz+Funk", "Fusion",
  "Trance", "Classical", "Instrumental", "Acid", "House", "Game", "Sound Clip", "Gospel",
  "Noise", "Alternative Rock", "Bass", "Soul", "Punk", "Space", "Meditative",
  "Instrumental Pop", "Instrumental Rock", "Ethnic", "Gothic", "Darkwave",
  "Techno-Industrial", "Electronic", "Pop-Folk", "Eurodance", "Dream", "Southern Rock",
  "Comedy", "Cult", "Gangsta", "Top 40", "Christian Rap", "Pop/Funk", "Jungle",
  "Native American", "Cabaret", "New Wave", "Psychedelic", "Rave", "Showtunes", "Trailer",
  "Lo-Fi", "Tribal", "Acid Punk", "Acid Jazz", "Polka", "Retro", "Musical", "Rock & Roll",
  "Hard Rock", "Folk", "Folk-Rock", "National Folk", "Swing", "Fast Fusion", "Bebob",
  "Latin", "Revival", "Celtic", "Bluegrass", "Avantgarde", "Gothic Rock", "Progressive Rock",
  "Psychedelic Rock", "Symphonic Rock", "Slow Rock", "Big Band", "Chorus", "Easy Listening",
  "Acoustic", "Humour", "Speech", "Chanson", "Opera", "Chamber Music", "Sonata", "Symphony",
  "Booty Bass", "Primus", "Porn Groove", "Satire", "Slow Jam", "Club", "Tango", "Samba",
  "Folklore", "Ballad", "Power Ballad", "Rhythmic Soul", "Freestyle", "Duet", "Punk Rock",
  "Drum Solo", "A Cappella", "Euro-House", "Dance Hall", "Goa", "Drum & Bass", "Club-House",
  "Hardcore Techno", "Terror", "Indie", "BritPop", "Negerpunk", "Polsk Punk", "Beat",
  "Christian Gangsta", "Heavy Metal", "Black Metal", "Crossover", "Contemporary Christian",
  "Christian Rock", "Merengue", "Salsa", "Thrash Metal", "Anime", "JPop", "SynthPop",
  "Abstract", "Art Rock", "Baroque", "Bhangra", "Big Beat", "Breakbeat", "Chillout",
  "Downtempo", "Dub", "EBM", "Eclectic", "Electro", "Electroclash", "Emo", "Experimental",
  "Garage", "Global", "IDM", "Illbient", "Industro-Goth", "Jam Band", "Krautrock", "Leftfield",
  "Lounge", "Math Rock", "New Romantic", "Nu-Breakz", "Post-Punk", "Post-Rock", "Psytrance",
  "Shoegaze", "Space Rock", "Trop Rock", "World Music", "Neoclassical", "Audiobook",
  "Audio Theatre", "Neue Deutsche Welle", "Podcast", "Indie Rock", "G-Funk", "Dubstep",
  "Garage Rock", "Psybient"
]);

function genreKey(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function splitGenreLabels(raw) {
  // Some legacy labels contain a slash themselves (notably "Pop/Funk").
  // Protect these labels before treating slash characters as separators.
  const compoundLabels = ID3_V1_GENRES.filter(label => label.includes("/"));
  const placeholders = new Map();
  let source = raw;
  compoundLabels.forEach((label, index) => {
    const pattern = label.split("/").map(part => part.trim()).join("\\s*\\/\\s*");
    const placeholder = "\u0002genre" + index + "\u0003";
    const matcher = new RegExp("(^|[\\s,;|+/])(" + pattern + ")(?=$|[\\s,;|+/])", "gi");
    source = source.replace(matcher, (_match, boundary) => boundary + placeholder);
    placeholders.set(placeholder, label);
  });
  return source.split(/\s*(?:\/|;|\||,|\s\+\s)\s*/).map(segment => {
    const value = segment.trim();
    return placeholders.get(value) || normalizeGenreSegment(value);
  }).filter(Boolean);
}
function normalizeAdjacentGenreCodes(raw) {
  if (!/^(?:\([0-9]{1,3}\))+$/i.test(raw)) return null;
  const labels = [...raw.matchAll(/\(([0-9]{1,3})\)/g)]
    .map(match => ID3_V1_GENRES[Number(match[1])]).filter(Boolean);
  return [...new Map(labels.map(label => [genreKey(label), label])).values()].join(" / ");
}

function normalizeGenreSegment(segment) {
  let raw = String(segment ?? "").trim();
  if (!raw) return "";
  // ID3v2 uses (RX) and (CR) as remix/cover modifiers before a genre code.
  // Strip them before parsing codes, otherwise "(RX)(17)" degrades to "(17)".
  raw = raw.replace(/^(?:\((?:RX|CR)\)\s*)+/i, "").trim();
  if (!raw) return "";
  const adjacentCodes = normalizeAdjacentGenreCodes(raw);
  if (adjacentCodes !== null) return adjacentCodes;
  const numeric = raw.match(/^\(?([0-9]{1,3})\)?$/);
  if (numeric) return ID3_V1_GENRES[Number(numeric[1])] || "";
  const prefixed = raw.match(/^\(([0-9]{1,3})\)\s*(.*)$/);
  if (prefixed) {
    const mapped = ID3_V1_GENRES[Number(prefixed[1])] || "";
    const tail = prefixed[2].trim();
    if (!mapped) return tail;
    return !tail || genreKey(tail) === genreKey(mapped) ? mapped : mapped + " / " + tail;
  }
  const loose = raw.match(/^([0-9]{1,3})\s+(.+)$/);
  if (loose) {
    const mapped = ID3_V1_GENRES[Number(loose[1])] || "";
    const tail = loose[2].trim();
    if (mapped && genreKey(tail) === genreKey(mapped)) return mapped;
  }
  return raw;
}

/** Resolve ID3v1/v2 numeric genre codes without discarding valid labels. */
export function normalizeId3Genre(value) {
  const raw = String(value ?? "").replace(/\u0000/g, " / ").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  // Preserve known compound ID3 labels such as "Pop/Funk". Splitting on every
  // slash would incorrectly turn a single legacy genre into two unrelated tags.
  const canonical = ID3_V1_GENRES.find(label => genreKey(label) === genreKey(raw));
  if (canonical) return canonical;
  // ID3 permits adjacent numeric codes such as "(17)(13)" as well as separated values.
  const adjacentCodes = normalizeAdjacentGenreCodes(raw);
  if (adjacentCodes !== null) return adjacentCodes;
  const parts = splitGenreLabels(raw);
  return [...new Map(parts.map(label => [genreKey(label), label])).values()].join(" / ");
}

/**
 * Maps a known track tag to the optional UI-feedback rhythm only.
 * This is not an audio genre classifier and must never alter track playback.
 * Unknown and distinct genres stay neutral instead of being guessed as pop.
 */
export function inferUiSoundRhythm(genre) {
  const text = genreKey(genre);
  if (!text) return null;
  // Keep rock subgenres ahead of pop in mixed labels such as "Pop Rock".
  if (/\b(rock|punk|metal|grunge|hardcore|emo|gothic|shoegaze|krautrock|math rock|post punk|post rock|britpop|indie rock|crossover|rock and roll|hard rock|progressive rock|psychedelic rock|alternative rock|death metal|black metal|thrash metal)\b/.test(text)) return "rock";
  if (/\b(cyberpunk|electronic|electronica|electro|techno|trance|edm|synthwave|industrial|dubstep|drum and bass|drum bass|dnb|tech house|house|breakbeat|big beat|jungle|idm|ebm|psytrance|goa|rave|electroclash|nu breakz|euro house|euro techno|eurodance|hardcore techno|techno industrial)\b/.test(text)) return "cyber";
  if (/\b(pop|k pop|j pop|jpop|dance pop|teen pop|electropop|synthpop|synth pop)\b/.test(text)) return "pop";
  return null;
}
