import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TAG,
  decodeLegacy,
  memoryReader,
  namedTags,
  parseId3v1,
  readAudioTags,
} from "../core/audio-tags.mjs";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 9, 9]);
const bytes = (...parts) => {
  const list = parts.map((p) =>
    typeof p === "string" ? new TextEncoder().encode(p) : Uint8Array.from(p),
  );
  const out = new Uint8Array(list.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of list) out.set(p, (at += p.length) - p.length);
  return out;
};
const latin = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const be32 = (n) => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const le32 = (n) => [
  n & 255,
  (n >>> 8) & 255,
  (n >>> 16) & 255,
  (n >>> 24) & 255,
];
const syncsafe = (n) => [
  (n >> 21) & 127,
  (n >> 14) & 127,
  (n >> 7) & 127,
  n & 127,
];
const utf16 = (s) => {
  const out = [0xff, 0xfe];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out.push(c & 255, c >> 8);
  }
  return out;
};

function id3(major, frames) {
  const body = bytes(
    ...frames.map(([id, data]) => {
      const size = major === 4 ? syncsafe(data.length) : be32(data.length);
      return bytes(id, size, [0, 0], data);
    }),
    new Uint8Array(32), // padding
  );
  return bytes("ID3", [major, 0, 0], syncsafe(body.length), body);
}
const mpegFrames = new Uint8Array(4096).fill(0xff);
// Counts every byte the reader asked for, to prove the audio is skipped.
const counted = (file) => {
  const reads = { bytes: 0 };
  const read = memoryReader(file);
  return {
    reads,
    read: async (offset, length) => {
      const part = await read(offset, length);
      reads.bytes += part.length;
      return part;
    },
  };
};

test("ID3v2.3 with UTF-16 text, a track 'n/total' and the front cover", async () => {
  const file = bytes(
    id3(3, [
      ["TIT2", bytes([1], utf16("عيونك"))],
      ["TPE1", bytes([1], utf16("محمد عبده"))],
      ["TALB", bytes([0], latin("Golden Hits"))],
      ["TRCK", bytes([0], latin("3/12"))],
      ["TYER", bytes([0], latin("1995"))],
      // A back cover first, then the front one: the front one wins.
      ["APIC", bytes([0], latin("image/png\0"), [4], [0], PNG)],
      ["APIC", bytes([0], latin("image/jpeg\0"), [3], latin("front\0"), JPEG)],
    ]),
    mpegFrames,
  );
  const tags = await readAudioTags({
    read: memoryReader(file),
    size: file.length,
    picture: true,
  });
  assert.equal(tags.title, "عيونك");
  assert.equal(tags.artist, "محمد عبده");
  assert.equal(tags.album, "Golden Hits");
  assert.equal(tags.track, 3);
  assert.equal(tags.year, 1995);
  assert.equal(tags.cover, true);
  assert.equal(tags.picture.mime, "image/jpeg");
  assert.deepEqual([...tags.picture.data], [...JPEG]);
  // Without asking for the picture, only the flag comes back.
  const light = await readAudioTags({
    read: memoryReader(file),
    size: file.length,
  });
  assert.equal(light.cover, true);
  assert.equal(light.picture, undefined);
});

test("ID3v2.4 UTF-8 frames with syncsafe sizes, and v2.2's three-letter frames", async () => {
  const v4 = id3(4, [
    ["TIT2", bytes([3], "Fly Me to the Moon")],
    ["TPE2", bytes([3], "Frank Sinatra")],
    ["TDRC", bytes([3], "1964-05-01")],
  ]);
  const t4 = await readAudioTags({ read: memoryReader(v4), size: v4.length });
  assert.equal(t4.title, "Fly Me to the Moon");
  assert.equal(t4.albumArtist, "Frank Sinatra");
  assert.equal(t4.year, 1964);

  const frame = (id, data) =>
    bytes(
      id,
      [(data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255],
      data,
    );
  const body = bytes(
    frame("TT2", bytes([0], latin("Old Song"))),
    frame("TP1", bytes([0], latin("Someone"))),
    frame("PIC", bytes([0], latin("JPG"), [3], [0], JPEG)),
  );
  const v2 = bytes("ID3", [2, 0, 0], syncsafe(body.length), body);
  const t2 = await readAudioTags({ read: memoryReader(v2), size: v2.length });
  assert.deepEqual(t2, { title: "Old Song", artist: "Someone", cover: true });
});

test("ID3v1 at the end of an MP3, and Arabic in the old Windows code page", async () => {
  const v1 = new Uint8Array(128);
  v1.set(latin("TAG"));
  v1.set(latin("Hotel California"), 3);
  v1.set(latin("Eagles"), 33);
  v1.set(latin("1976"), 93);
  v1[126] = 7;
  const file = bytes(mpegFrames, v1);
  const tags = await readAudioTags({
    read: memoryReader(file),
    size: file.length,
  });
  assert.deepEqual(tags, {
    title: "Hotel California",
    artist: "Eagles",
    year: 1976,
    track: 7,
  });
  // "أم كلثوم" written as Windows-1256 bytes reads as Arabic, not as "Ãã ßáËæã".
  const cp1256 = Uint8Array.from([
    0xc3, 0xe3, 0x20, 0xdf, 0xe1, 0xcb, 0xe6, 0xe3,
  ]);
  assert.equal(decodeLegacy(cp1256), "أم كلثوم");
  assert.equal(decodeLegacy(latin("Café")), "Café");
  assert.equal(decodeLegacy(new TextEncoder().encode("فيروز")), "فيروز");
  assert.deepEqual(parseId3v1(new Uint8Array(128)), {});
});

test("FLAC comments and picture block, after skipping a large seek table unread", async () => {
  const comment = bytes(
    le32(6),
    "riwaq!",
    le32(3),
    le32(17),
    "TITLE=Bohemian Rh",
    le32(12),
    "ARTIST=Queen",
    le32(14),
    "TRACKNUMBER=11",
  );
  const picture = bytes(
    be32(3),
    be32(10),
    "image/jpeg",
    be32(0),
    be32(1),
    be32(1),
    be32(24),
    be32(0),
    be32(JPEG.length),
    JPEG,
  );
  const block = (type, data, last = false) =>
    bytes(
      [
        type | (last ? 0x80 : 0),
        (data.length >> 16) & 255,
        (data.length >> 8) & 255,
        data.length & 255,
      ],
      data,
    );
  const seekTable = new Uint8Array(200000);
  const file = bytes(
    "fLaC",
    block(0, new Uint8Array(34)),
    block(3, seekTable),
    block(4, comment),
    block(6, picture, true),
    new Uint8Array(500000),
  );
  const { read, reads } = counted(file);
  const tags = await readAudioTags({ read, size: file.length, picture: true });
  assert.equal(tags.title, "Bohemian Rh");
  assert.equal(tags.artist, "Queen");
  assert.equal(tags.track, 11);
  assert.equal(tags.picture.mime, "image/jpeg");
  assert.ok(reads.bytes < 2000, `read ${reads.bytes} bytes`);
});

function oggPage(packet, flags = 0) {
  const lacing = [];
  let left = packet.length;
  while (left >= 255) {
    lacing.push(255);
    left -= 255;
  }
  lacing.push(left);
  return bytes(
    "OggS",
    [0, flags],
    new Uint8Array(20),
    [lacing.length],
    lacing,
    packet,
  );
}

test("Ogg Vorbis and Opus comments, including a cover in METADATA_BLOCK_PICTURE", async () => {
  const picture = bytes(
    be32(3),
    be32(9),
    "image/png",
    be32(0),
    be32(1),
    be32(1),
    be32(24),
    be32(0),
    be32(PNG.length),
    PNG,
  );
  const pictureEntry = `METADATA_BLOCK_PICTURE=${Buffer.from(picture).toString("base64")}`;
  const comments = (...entries) =>
    bytes(
      le32(3),
      "lib",
      le32(entries.length),
      ...entries.map((e) => bytes(le32(new TextEncoder().encode(e).length), e)),
    );
  const vorbis = bytes(
    oggPage(bytes([1], "vorbis", new Uint8Array(23))),
    oggPage(
      bytes(
        [3],
        "vorbis",
        comments("title=Asfour", "ARTIST=مارسيل خليفة", pictureEntry),
      ),
    ),
  );
  const tv = await readAudioTags({
    read: memoryReader(vorbis),
    size: vorbis.length,
  });
  assert.deepEqual(tv, {
    title: "Asfour",
    artist: "مارسيل خليفة",
    cover: true,
  });

  // A comment packet longer than one page's 255 segments spans two pages.
  const long = comments("TITLE=" + "س".repeat(40000), "ALBUM=Long");
  const first = long.subarray(0, 255 * 255),
    rest = long.subarray(255 * 255);
  const opus = bytes(
    oggPage(bytes("OpusHead", new Uint8Array(11))),
    bytes(
      "OggS",
      [0, 0],
      new Uint8Array(20),
      [255],
      new Array(255).fill(255),
      bytes("OpusTags", first.subarray(0, 255 * 255 - 8)),
    ),
    oggPage(bytes(first.subarray(255 * 255 - 8), rest)),
  );
  const to = await readAudioTags({
    read: memoryReader(opus),
    size: opus.length,
  });
  assert.equal(to.album, "Long");
  assert.equal(to.title.length, 100, "titles are trimmed to 100 characters");
});

const box = (type, ...content) => {
  const body = bytes(...content);
  return bytes(be32(body.length + 8), latin(type), body);
};
const dataBox = (kind, value) => box("data", be32(kind), be32(0), value);

test("MP4 tags in moov/udta/meta/ilst, with the movie atom after a large mdat", async () => {
  const ilst = box(
    "ilst",
    box("©nam", dataBox(1, "Thriller")),
    box("©ART", dataBox(1, "Michael Jackson")),
    box("©alb", dataBox(1, "Thriller")),
    box("trkn", dataBox(0, [0, 0, 0, 4, 0, 9, 0, 0])),
    box("©day", dataBox(1, "1982-11-30")),
    box("covr", dataBox(13, JPEG)),
  );
  const meta = box("meta", [0, 0, 0, 0], box("hdlr", new Uint8Array(25)), ilst);
  const moov = box("moov", box("mvhd", new Uint8Array(100)), box("udta", meta));
  const mdat = box("mdat", new Uint8Array(3_000_000));
  const file = bytes(box("ftyp", "M4A ", be32(0)), mdat, moov);
  const { read, reads } = counted(file);
  const tags = await readAudioTags({ read, size: file.length, picture: true });
  assert.equal(tags.title, "Thriller");
  assert.equal(tags.artist, "Michael Jackson");
  assert.equal(tags.track, 4);
  assert.equal(tags.year, 1982);
  assert.equal(tags.picture.mime, "image/jpeg");
  assert.ok(
    reads.bytes < 4000,
    `the audio was not read (${reads.bytes} bytes)`,
  );
});

test("WAV LIST/INFO tags and an id3 chunk", async () => {
  const sub = (id, text) => {
    const data = bytes(text, [0]);
    return bytes(id, le32(data.length), data, data.length & 1 ? [0] : []);
  };
  const info = bytes("INFO", sub("INAM", "Lamma Bada"), sub("IART", "Fairuz"));
  const tag = id3(3, [["TALB", bytes([3], "Andalusiyat")]]);
  const file = bytes(
    "RIFF",
    le32(0),
    "WAVE",
    "fmt ",
    le32(16),
    new Uint8Array(16),
    "data",
    le32(100000),
    new Uint8Array(100000),
    "LIST",
    le32(info.length),
    info,
    "id3 ",
    le32(tag.length),
    tag,
  );
  const { read, reads } = counted(file);
  const tags = await readAudioTags({ read, size: file.length });
  assert.deepEqual(tags, {
    title: "Lamma Bada",
    artist: "Fairuz",
    album: "Andalusiyat",
  });
  assert.ok(reads.bytes < 2000);
});

test("broken, empty and hostile input gives no tags and never throws", async () => {
  for (const file of [
    new Uint8Array(0),
    latin("ID3"),
    bytes("ID3", [3, 0, 0], [127, 127, 127, 127], latin("TIT2")),
    bytes("fLaC", [4, 255, 255, 255]),
    bytes("OggS", new Uint8Array(40)),
    bytes(be32(1), "ftyp", be32(0), be32(0)),
    bytes("RIFF", le32(4), "WAVE", "LIST", le32(0xffffffff)),
    new Uint8Array(1000).fill(0x41),
  ]) {
    const tags = await readAudioTags({
      read: memoryReader(file),
      size: file.length,
    });
    assert.equal(typeof tags, "object");
    assert.equal(tags.title, undefined, `${[...file.subarray(0, 4)]}`);
  }
  assert.deepEqual(
    await readAudioTags({
      read: async () => {
        throw new Error("gone");
      },
    }),
    {},
  );
  // An ID3 tag declaring more than MAX_TAG is not read at all.
  const huge = bytes(
    "ID3",
    [3, 0, 0],
    syncsafe(MAX_TAG + 1),
    new Uint8Array(64),
  );
  const { read, reads } = counted(huge);
  await readAudioTags({ read, size: huge.length });
  assert.ok(reads.bytes < 200);
});

test("file names give a title and artist when a file has no tags", () => {
  assert.deepEqual(namedTags("03 - Mohammed Abdu - Al Amaken"), {
    artist: "Mohammed Abdu",
    title: "Al Amaken",
  });
  assert.deepEqual(namedTags("كاظم الساهر – زيديني عشقاً"), {
    artist: "كاظم الساهر",
    title: "زيديني عشقاً",
  });
  assert.deepEqual(namedTags("50 Cent - In da Club"), {
    artist: "50 Cent",
    title: "In da Club",
  });
  assert.deepEqual(namedTags("01. Intro"), { title: "Intro" });
  assert.deepEqual(namedTags("2Pac"), { title: "2Pac" });
});
