# Riwaq 0.4 — personal watch queue and library

Built on the existing 0.3 main commit `60b2924b6c851f49f352b29514f890ddef03a573`; the stream engine, Live TV, profiles and player extensions are preserved.

- A persistent queue belongs to each viewer. Add the selected movie or episode from Details, reorder it with up/down controls, remove entries, and choose a source before playing. Duplicate episodes are ignored and capacity is 200.
- Queue entries retain title identity and display metadata, never stream URLs. They are consumed after MPV reports file-loaded, so unavailable metadata or streams leave entries intact.
- Autoplay remains disabled by default. When enabled, an ended movie or episode advances to the first queued title, then to the next released episode if the queue is empty. Explicit previous/next episode buttons remain episodic. Future-dated episodes are disabled in Details.
- Library tabs separate saved titles, continue watching, queue, recent history per title and connected platform lists. Arabic search ignores diacritics; filters select media type; alphabetical/year sorting is available outside the queue.
- History can be marked complete or removed locally. Manual history edits never enqueue Trakt writes; the currently playing item's history cannot be changed until playback stops.
- Continue watching groups by media type and title before excluding completed entries. Finishing a newer episode no longer revives an older partial episode, and a movie and series sharing an ID no longer collide.
- Profile switching/removal stops playback and saves the outgoing viewer's progress first. Pending automatic advancement is cancelled when the viewer changes playback or profile. Library browsing resets when profiles change.

## Limits

The queue is local to this installation and profile, not synchronized to Stremio or a tracker. New entries are resolved against currently enabled addons at playback time. No new third-party accounts or permissions are required. Existing documented hardware, real-account, IPTV, unsigned-binary and external Stremio Service limitations still apply.
