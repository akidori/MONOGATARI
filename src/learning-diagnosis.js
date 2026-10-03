// Learning/diagnosis reliability helpers. They never migrate or delete stored data.
const record = (x) => !!x && typeof x === "object" && !Array.isArray(x);

export async function readCreatorProfile(storage, key) {
  if (!storage || typeof storage.get !== "function") throw new Error("storage unavailable");
  let result;
  try { result = await storage.get(key); }
  catch (error) {
    // Both supported storage adapters use exactly "nf" for a missing key.
    if (error && error.message === "nf" && !error.code) return null;
    throw error;
  }
  if (!result || typeof result.value !== "string") throw new Error("invalid profile response");
  const profile = JSON.parse(result.value);
  if (!record(profile)) throw new Error("invalid profile");
  for (const key of ["answers", "steps", "avail"]) {
    if (profile[key] != null && !record(profile[key])) throw new Error("invalid profile field");
  }
  for (const key of ["skills", "software", "portfolio"]) {
    if (profile[key] != null && !Array.isArray(profile[key])) throw new Error("invalid profile field");
  }
  if (profile.avail && profile.avail.offDays != null && !Array.isArray(profile.avail.offDays)) throw new Error("invalid off days");
  return profile;
}

export async function writeCreatorProfile(storage, key, profile) {
  if (!storage || typeof storage.set !== "function") throw new Error("storage unavailable");
  await storage.set(key, JSON.stringify(profile));
  return profile;
}

export function stepsToLearnGroups(data) {
  if (!record(data) || !Array.isArray(data.phases)) throw new Error("invalid learning data");
  return data.phases.map((phase) => {
    if (!record(phase) || !Array.isArray(phase.steps)) throw new Error("invalid learning phase");
    return {
      title: "作業ステップ：" + String(phase.title || ""),
      items: phase.steps.map((step, i) => {
        if (!record(step) || !step.id || typeof step.do !== "string") throw new Error("invalid learning step");
        return {
          id: "step-" + phase.id + "-" + step.id,
          title: (i + 1) + ". " + step.do,
          goal: i === 0 ? String(phase.goal || "") : "",
          steps: step.tip ? [String(step.tip)] : [],
          qa: (Array.isArray(step.help) ? step.help : []).map((help) => ({
            q: String((help && help.q) || ""),
            a: (Array.isArray(help && help.a) ? help.a : []).map((answer) => {
              // The shared source also serves the Premiere plugin. Adapt this
              // action claim only in the read-only learning UI, never its source.
              return phase.id === "rough" && step.id === "read" && String(answer).trim() === "AK に自動で知らせました"
                ? "構成台本が見当たらないことを AK に連絡してください。この学習ページから自動通知は送られません。"
                : String(answer);
            }),
            src: String((help && help.src) || ""),
          })),
        };
      }),
    };
  }).filter((group) => group.items.length);
}

export async function fetchLearnSteps(fetcher, url, signal) {
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error("learning request failed");
  const body = await response.json();
  if (!body || !body.connected) throw new Error("learning unavailable");
  const groups = stepsToLearnGroups(body.data);
  return { groups, version: String(body.data.version || body.sha || "") };
}
