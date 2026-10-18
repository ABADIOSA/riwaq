// Separate from encrypted accounts: no account foreign key, raw IP, title or event log.
export async function usageRoute(
  request,
  env,
  now,
  { reply, sha256, equal, limited, count, addressKey },
) {
  const path = new URL(request.url).pathname,
    db = env.DB;
  const admin = String(env.METRICS_ADMIN_KEY || "");
  if (!/^[a-f0-9]{64}$/.test(admin))
    return reply(503, { error: "metrics_not_configured" });
  if (path === "/v1/admin/usage") {
    if (request.method !== "GET")
      return reply(405, { error: "method_not_allowed" });
    const supplied =
      request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
    if (!equal(await sha256(supplied), await sha256(admin)))
      return reply(401, { error: "unauthorized" });
    await db
      .prepare("DELETE FROM usage_devices WHERE seen_at < ?1")
      .bind(now - 31 * 86400000)
      .run();
    const counts = await db
      .prepare(
        "SELECT SUM(CASE WHEN seen_at >= ?1 THEN 1 ELSE 0 END) AS online, SUM(CASE WHEN seen_at >= ?2 THEN 1 ELSE 0 END) AS day, SUM(CASE WHEN seen_at >= ?3 THEN 1 ELSE 0 END) AS month FROM usage_devices WHERE revoked = 0",
      )
      .bind(now - 10 * 60000, now - 86400000, now - 30 * 86400000)
      .first();
    const { results: versions } = await db
      .prepare(
        "SELECT platform, version, COUNT(*) AS devices FROM usage_devices WHERE revoked = 0 AND seen_at >= ?1 GROUP BY platform, version ORDER BY devices DESC LIMIT 100",
      )
      .bind(now - 30 * 86400000)
      .all();
    return reply(200, {
      at: now,
      online: counts.online || 0,
      day: counts.day || 0,
      month: counts.month || 0,
      windowMinutes: 10,
      versions,
    });
  }
  if (!["POST", "DELETE"].includes(request.method))
    return reply(405, { error: "method_not_allowed" });
  if (await limited(db, addressKey("usage"), [60, 60000], now))
    return reply(429, { error: "rate_limited" });
  await count(db, addressKey("usage"), [60, 60000], now);
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw Error();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024) throw Error();
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    body = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    return reply(400, { error: "invalid_body" });
  }
  const deleting = request.method === "DELETE";
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !/^[a-f0-9]{64}$/.test(body.token || "") ||
    Object.keys(body).some(
      (k) =>
        !(deleting ? ["token"] : ["token", "platform", "version"]).includes(k),
    )
  )
    return reply(400, { error: "invalid_body" });
  if (
    !deleting &&
    (!["desktop", "web"].includes(body.platform) ||
      !/^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-zA-Z0-9.-]{1,30})?$/.test(
        body.version || "",
      ))
  )
    return reply(400, { error: "invalid_body" });
  const hash = await sha256(env.AUTH_PEPPER, "usage-device", body.token);
  // Tokens are bearer capabilities for deletion only, never account credentials.
  if (deleting)
    await db
      .prepare(
        "INSERT INTO usage_devices(token_hash,platform,version,seen_at,revoked) VALUES(?1,'','',?2,1) ON CONFLICT(token_hash) DO UPDATE SET platform='',version='',seen_at=excluded.seen_at,revoked=1",
      )
      .bind(hash, now)
      .run();
  else
    await db
      .prepare(
        "INSERT INTO usage_devices(token_hash,platform,version,seen_at,revoked) VALUES(?1,?2,?3,?4,0) ON CONFLICT(token_hash) DO UPDATE SET platform=excluded.platform,version=excluded.version,seen_at=excluded.seen_at WHERE usage_devices.revoked=0 AND usage_devices.seen_at <= ?5",
      )
      .bind(hash, body.platform, body.version, now, now - 60000)
      .run();
  if (Math.random() < 0.02)
    await db
      .prepare("DELETE FROM usage_devices WHERE seen_at < ?1")
      .bind(now - 31 * 86400000)
      .run();
  return reply(204, null);
}
