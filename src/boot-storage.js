// Absence is an explicit storage result, never a network/parse failure.
export async function readBootJSON(storage, key, validate, optional = false) {
  let result;
  try { result = await storage.get(key); }
  catch (error) {
    if (optional && error?.message === "nf") return null;
    throw error;
  }
  if (!result || typeof result.value !== "string") throw new Error("保存データを確認できません: " + key);
  const value = JSON.parse(result.value);
  if (!validate(value)) throw new Error("保存データの形式を確認できません: " + key);
  return value;
}

export const bootRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
export const bootIndex = (value) => Array.isArray(value)
  && value.every((entry) => bootRecord(entry) && typeof entry.id === "string" && entry.id.length > 0)
  && new Set(value.map((entry) => entry.id)).size === value.length;
export const bootProject = (value) => bootRecord(value)
  && (value.rows === undefined || Array.isArray(value.rows))
  && (value.plans === undefined || Array.isArray(value.plans));
