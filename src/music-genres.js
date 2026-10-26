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

function normalizeGenreSegment(segment) {
  const raw = String(segment ?? "").trim();
  if (!raw) return "";
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
  return raw.replace(/^\((?:RX|CR)\)\s*/i, "").trim();
}

/** Resolve ID3v1/v2 numeric genre codes without discarding valid labels. */
export function normalizeId3Genre(value) {
  const raw = String(value ?? "").replace(/\u0000/g, " / ").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  // ID3 permits adjacent numeric codes such as "(17)(13)" as well as separated values.
  const adjacentCodes = raw.match(/^(?:\([0-9]{1,3}\))+$/);
  if (adjacentCodes) {
    const labels = [...raw.matchAll(/\(([0-9]{1,3})\)/g)]
      .map(match => ID3_V1_GENRES[Number(match[1])]).filter(Boolean);
    return [...new Map(labels.map(label => [genreKey(label), label])).values()].join(" / ");
  }
  const parts = raw.split(/\s*(?:\/|;|\||,|\s\+\s)\s*/).map(normalizeGenreSegment).filter(Boolean);
  return [...new Map(parts.map(label => [genreKey(label), label])).values()].join(" / ");
}

export function inferUiSoundRhythm(genre) {
  const text = genreKey(genre);
  if (!text) return null;
  // A composite rock tag is rock even when it also contains "pop" or "alternative".
  if (/\b(rock|punk|metal|grunge|hardcore|emo|gothic|shoegaze|krautrock|math rock|post punk|post rock|britpop|indie rock|crossover)\b/.test(text)) return "rock";
  if (/\b(cyberpunk|electronic|electronica|electro|techno|trance|edm|synthwave|industrial|dubstep|drum and bass|dnb|tech house|house|breakbeat|big beat|jungle|idm|ebm|psytrance|goa|rave|synthpop|electroclash|nu breakz)\b/.test(text)) return "cyber";
  if (/\b(pop|k pop|j pop|dance pop|teen pop|electropop|popular|disco|dance|eurodance|euro house|funk|r and b|r b|hip hop|rap|soul|reggae|dance hall|dancehall|latin|salsa|merengue|cumbia|reggaeton|afrobeats|freestyle|club)\b/.test(text)) return "pop";
  return null;
}
