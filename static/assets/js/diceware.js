'use strict';

// 512-word list (power-of-2 size eliminates modulo bias when ANDing with 0x1FF)
const WORDS = [
  "able","acid","aged","also","area","army","back","ball","band","bank","base","bath","bear","beat","been","bell",
  "best","bill","bird","bite","blue","boat","body","bold","bone","book","born","both","bull","burn","call","calm",
  "came","card","care","cart","cash","cast","cave","cell","chip","cite","city","clam","clan","clay","clip","club",
  "coal","coat","code","coil","coin","cold","comb","cone","copy","cord","core","corn","cost","coup","crab","crew",
  "crop","curl","dame","dare","dark","dash","data","date","dawn","dead","deal","dean","dear","debt","deck","deed",
  "deep","deft","deny","desk","diet","dire","disk","dock","dome","done","door","dorm","dose","dove","down","draw",
  "drew","drip","drop","drum","dual","dune","dusk","dust","duty","each","earl","earn","ease","east","edge","epic",
  "even","ever","exam","exit","fade","fair","fall","farm","fast","fate","fawn","fear","feat","feed","feel","feet",
  "fell","felt","fern","fill","film","find","fine","fire","firm","fish","fist","flag","flat","fled","flex","flip",
  "flow","foam","folk","fond","food","fool","ford","fore","fork","form","fort","foul","free","from","fuel","full",
  "fund","fuse","gale","game","gate","gave","gear","give","glad","glob","glow","glue","goal","gold","golf","gone",
  "good","gore","gown","grab","gram","gray","grew","grid","grip","grit","grow","gulf","gust","hack","hail","half",
  "hall","halt","hand","hang","hard","harp","hash","hate","have","hawk","heal","heap","heat","heel","heir","held",
  "helm","help","herd","here","hero","high","hill","hint","hire","hold","hole","home","hook","hope","horn","host",
  "hour","hull","hunt","hurt","icon","idle","inch","into","iris","iron","isle","item","jade","jail","jest","join",
  "joke","keen","keep","kind","king","knot","lace","lake","lane","last","lava","lawn","lead","leaf","lean","left",
  "lend","lens","lest","lift","lily","limb","lime","link","lion","list","live","lock","loft","loop","lord","lore",
  "loss","lost","loud","love","luck","lure","lush","mace","made","main","make","mall","mane","many","mare","mark",
  "mart","mast","math","maze","meal","mean","meat","mesh","mild","mill","mind","mine","mist","mode","mole","moon",
  "moor","more","moss","most","moth","move","much","muse","must","myth","name","navy","neck","need","nest","news",
  "next","nice","nine","node","none","noon","norm","note","noun","oath","obey","once","only","open","oral","over",
  "pack","page","paid","pale","palm","park","part","past","path","peak","peel","peer","pick","pier","pile","pine",
  "pipe","plan","play","plot","plow","plug","plus","poem","poet","pole","poll","pond","pool","poor","port","pose",
  "post","pour","prey","prop","pull","pure","push","quit","race","rack","rage","rail","rain","rank","rare","rate",
  "read","real","reed","reef","reel","rely","rent","rest","rice","rich","ride","ring","rise","risk","road","rock",
  "role","roll","roof","room","root","rope","rose","ruin","rule","rush","rust","safe","sage","sail","sake","salt",
  "same","sand","save","scan","seal","seed","self","sell","send","shed","ship","shop","shot","show","silk","sill",
  "sing","sink","site","size","skin","skip","slim","slip","slow","slur","snap","snow","soak","soar","soft","soil",
  "sold","sole","song","soot","sort","soul","span","spin","spot","spur","star","stem","step","stir","stop","such",
  "suit","sure","swan","tall","tang","task","teak","teal","team","tear","tech","tell","tend","tent","term","text",
  "than","then","this","tide","tier","till","tilt","time","tint","tire","toll","tone","tool","tore","torn","tour",
  "town","trap","tray","trek","trim","trio","trip","true","tube","tuck","tuft","tune","turf","turn","twin","type",
];

// Generate a random passphrase of `count` words using the Web Crypto RNG
function generatePassphrase(count = 5) {
  // 9 random bits per word → indices 0–511 (no bias since WORDS.length === 512)
  const bytes = crypto.getRandomValues(new Uint8Array(count * 2));
  const words = [];
  for (let i = 0; i < count; i++) {
    // Combine two bytes into a 16-bit value, mask to 9 bits
    const idx = ((bytes[i * 2] << 8) | bytes[i * 2 + 1]) & 0x1FF;
    words.push(WORDS[idx]);
  }
  return words.join('-');
}
