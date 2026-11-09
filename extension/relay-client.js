async function request(origin, route, payload) {
  let response;
  try {
    response = await fetch(`${origin}${route}`, {
      ...(payload && {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      }),
      credentials: "omit", redirect: "error", signal: AbortSignal.timeout(5000)
    });
  } catch {
    throw new Error("Can’t reach PegParty. Check that the relay and its tunnel are running.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw Object.assign(new Error(data?.error ?? "This address did not respond as a PegParty relay."), {
      status: response.status
    });
  }
  return data;
}

function api(origin, action, payload) {
  return request(origin, `/api/pegparty/${action}`, payload);
}

