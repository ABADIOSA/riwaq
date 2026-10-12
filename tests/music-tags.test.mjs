import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MusicLibrary,
  TAG_BATCH,
  fileTags,
} from "../electron/music-library.mjs";
import { WebMusicLibrary } from "../web/music.js";
import { Client } from "../core/client.mjs";
import {
  albumsOf,
  artistsOf,
  songLine,
  songsOf,
} from "../core/music-groups.mjs";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 0xff, 0xd9]);
const syncsafe = (n) => [
  (n >> 21) & 127,
  (n >> 14) & 127,
  (n >> 7) & 127,
  n & 127,
];
const be32 = (n) => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
/** A small MP3: an ID3v2.3 tag with UTF-8-free Latin text, then frames. */
function mp3({ title, artist, album, track, cover }) {
  const text = (s) =>
    Buffer.concat([Buffer.from([0]), Buffer.from(s, "latin1")]);
  const frames = [];
  const frame = (id, data) =>
    frames.push(
      Buffer.concat([
        Buffer.from(id),
        Buffer.from(be32(data.length)),
        Buffer.from([0, 0]),
        data,
      ]),
    );
  if (title) frame("TIT2", text(title));
  if (artist) frame("TPE1", text(artist));
  if (album) frame("TALB", text(album));
  if (track) frame("TRCK", text(String(track)));
  if (cover)
    frame(
      "APIC",
      Buffer.concat([
        Buffer.from([0]),
        Buffer.from("image/jpeg\0"),
        Buffer.from([3, 0]),
        Buffer.from(JPEG),
      ]),
    );
  const body = Buffer.concat(frames);
  return Buffer.concat([
    Buffer.from("ID3"),
    Buffer.from([3, 0, 0, ...syncsafe(body.length)]),
    body,
    Buffer.alloc(2048, 0xff),
  ]);
}
async function rig(thumbnail) {
  const folder = await mkdtemp(join(tmpdir(), "riwaq-tags-test-"));
  const write = async (name, data) => {
    const path = join(folder, name);
    await writeFile(path, data);
    return path;
  };
  let saved;
  const client = new Client({
    load: () => ({}),
    save: (s) => (saved = structuredClone(s)),
  });
  return {
    write,
    client,
    library: new MusicLibrary(client, { thumbnail }),
    saved: () => saved,
  };
}

test("adding songs reads their tags; untagged files fall back to the name", async () => {
  const { write, library } = await rig();
  const tagged = await write(
    "track01.mp3",
    mp3({
      title: "Inta Omri",
      artist: "Umm Kulthum",
      album: "Classics",
      track: 2,
      cover: true,
    }),
  );
  const named = await write(
    "04 - Fairuz - Kifak Inta.mp3",
    Buffer.alloc(512, 0xff),
  );
  const view = await library.importFiles("default", [tagged, named]);
  const [a, b] = view.tracks;
  assert.deepEqual(
    {
      title: a.title,
      artist: a.artist,
      album: a.album,
      track: a.track,
      cover: a.cover,
    },
    {
      title: "Inta Omri",
      artist: "Umm Kulthum",
      album: "Classics",
      track: 2,
      cover: true,
    },
  );
  assert.deepEqual(
    { title: b.title, artist: b.artist, album: b.album, cover: b.cover },
    { title: "Kifak Inta", artist: "Fairuz", album: "", cover: false },
  );
  assert.equal(view.untagged, 0);
  assert.doesNotMatch(JSON.stringify(view), /riwaq-tags-test|\.mp3/);
});

test("songs added before 0.41 get their tags a batch per library request", async () => {
  const { write, client, library } = await rig();
  const files = [];
  for (let i = 0; i < TAG_BATCH + 5; i++)
    files.push(
      await write(`s${i}.mp3`, mp3({ title: `Song ${i}`, artist: "Old" })),
    );
  // The library as 0.40 stored it: the file name only, no tag fields.
  client.state.localMusic = {
    default: {
      tracks: files.map((path, i) => ({
        id: `t${i}`,
        path,
        title: `s${i}`,
        format: "MP3",
        favorite: i === 0,
      })),
      playlists: [],
      queue: [],
    },
  };
  assert.equal(library.view("default").untagged, TAG_BATCH + 5);
  assert.equal(await library.tagSome("default"), TAG_BATCH);
  let view = library.view("default");
  assert.equal(view.untagged, 5);
  assert.equal(view.tracks[0].title, "Song 0");
  assert.equal(view.tracks[0].artist, "Old");
  assert.equal(view.tracks[0].favorite, true, "what the viewer set stays");
  await library.tagSome("default");
  view = library.view("default");
  assert.equal(view.untagged, 0);
  assert.equal(await library.tagSome("default"), 0);
});

test("tags read for one profile are dropped when the profile changes during the read", async () => {
  const { write, client, library } = await rig();
  const path = await write("x.mp3", mp3({ title: "X" }));
  client.state.localMusic = {
    default: {
      tracks: [{ id: "t", path, title: "x", format: "MP3" }],
      playlists: [],
      queue: [],
    },
  };
  library.readTags = async () => {
    client.profiles.store.active = "someone-else";
    return { title: "Leaked" };
  };
  await assert.rejects(library.tagSome("default"), /تغير الملف الشخصي/);
  assert.equal(client.state.localMusic.default.tracks[0].title, "x");
});

test("covers come as small images made in memory, shared by an album, gone on revoke", async () => {
  const made = [];
  const { write, library } = await rig((bytes, mime) => {
    made.push(mime);
    return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
  });
  const one = await write(
    "1.mp3",
    mp3({ title: "A", artist: "X", album: "Al", cover: true }),
  );
  const two = await write(
    "2.mp3",
    mp3({ title: "B", artist: "X", album: "Al", cover: true }),
  );
  const bare = await write("3.mp3", mp3({ title: "C" }));
  const { tracks } = await library.importFiles("default", [one, two, bare]);
  const url = await library.cover({ profileId: "default", id: tracks[0].id });
  assert.match(url, /^data:image\/jpeg;base64,/);
  assert.equal(
    await library.cover({ profileId: "default", id: tracks[1].id }),
    url,
  );
  assert.deepEqual(made, ["image/jpeg"], "one picture per album");
  assert.equal(
    await library.cover({ profileId: "default", id: tracks[2].id }),
    null,
  );
  library.revoke();
  await library.cover({ profileId: "default", id: tracks[0].id });
  assert.equal(made.length, 2, "a lock or profile change forgets covers");
  await assert.rejects(
    library.cover({ profileId: "other", id: tracks[0].id }),
    /تغير الملف الشخصي/,
  );
  // Without a thumbnail maker (or a cover) there is no picture.
  const plain = new MusicLibrary(library.client);
  assert.equal(
    await plain.cover({ profileId: "default", id: tracks[0].id }),
    null,
  );
});

test("the file reader reads in bounded pieces and survives a missing file", async () => {
  const { write } = await rig();
  const path = await write("t.mp3", mp3({ title: "T", album: "Z" }));
  assert.deepEqual(await fileTags(path), { title: "T", album: "Z" });
  assert.deepEqual(await fileTags(path + ".missing"), {});
});

test("web songs carry the same tags and covers, read from the picked file", async () => {
  const client = { profiles: { gate() {}, store: { active: "p1" } } };
  const music = new WebMusicLibrary(client, {
    thumbnail: async (bytes, mime) => `data:${mime};len=${bytes.length}`,
  });
  const file = new File(
    [
      mp3({
        title: "Zay El Hawa",
        artist: "Abdel Halim",
        album: "Best",
        cover: true,
      }),
    ],
    "zay.mp3",
    { lastModified: 5 },
  );
  const view = await music.importFiles("p1", [
    file,
    new File([Buffer.alloc(100)], "Ali - Song.mp3"),
  ]);
  assert.equal(view.tracks[0].title, "Zay El Hawa");
  assert.equal(view.tracks[0].album, "Best");
  assert.equal(view.tracks[1].artist, "Ali");
  assert.equal(view.untagged, 0);
  assert.equal(
    await music.cover({ profileId: "p1", id: view.tracks[0].id }),
    `data:image/jpeg;len=${JPEG.length}`,
  );
  assert.equal(
    await music.cover({ profileId: "p1", id: view.tracks[1].id }),
    null,
  );
});

test("albums and artists group the library, in track order, Arabic-folded", () => {
  const tracks = [
    {
      id: "1",
      title: "Two",
      artist: "Fairuz",
      album: "Andalusiyat",
      track: 2,
      cover: true,
    },
    { id: "2", title: "One", artist: "Fairuz", album: "andalusiyat", track: 1 },
    {
      id: "3",
      title: "Duet",
      artist: "Wadih",
      album: "Hits",
      albumArtist: "Various",
    },
    {
      id: "4",
      title: "Solo",
      artist: "Sabah",
      album: "Hits",
      albumArtist: "Various",
    },
    { id: "5", title: "Loose", artist: "Fairuz" },
    { id: "6", title: "Mix", artist: "A", album: "Party" },
    { id: "7", title: "Mix 2", artist: "B", album: "Party" },
  ];
  const albums = albumsOf(tracks);
  assert.deepEqual(
    albums.map((a) => [a.name, a.artist, a.count]),
    [
      ["Andalusiyat", "Fairuz", 2],
      ["Hits", "Various", 2],
      ["Party", "فنانون متعددون", 2],
    ],
  );
  assert.equal(albums[0].coverId, "1");
  assert.deepEqual(
    songsOf(tracks, { kind: "album", key: albums[0].key }).map((t) => t.title),
    ["One", "Two"],
  );
  const artists = artistsOf(tracks);
  const fairuz = artists.find((a) => a.name === "Fairuz");
  assert.equal(fairuz.count, 3);
  assert.equal(fairuz.albumCount, 1);
  assert.deepEqual(
    songsOf(tracks, { kind: "artist", key: fairuz.key }).length,
    3,
  );
  assert.deepEqual(songsOf(tracks, { kind: "album", key: "gone|" }), []);
  assert.equal(songsOf(tracks, null), tracks);
  assert.equal(songLine(tracks[0]), "Fairuz · Andalusiyat");
  assert.equal(songLine({ format: "FLAC" }), "FLAC");
});
