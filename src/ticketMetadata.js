import fs from "node:fs/promises";
import path from "node:path";

const stateFile = process.env.HELPDESK_TICKET_METADATA_FILE || path.resolve(process.cwd(), "storage/state/ticket-metadata.json");

const ensureState = async () => {
  await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  try {
    return JSON.parse(await fs.readFile(stateFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {};
  }
};

const saveState = async (state) => {
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(temporary, stateFile);
};

const clean = (value, max) => String(value ?? "").trim().slice(0, max);

export const getTicketMetadata = async (ticketId) => {
  const state = await ensureState();
  return state[String(ticketId)] || {};
};

export const setTicketMetadata = async (ticketId, metadata = {}) => {
  const state = await ensureState();
  const company = clean(metadata.company ?? metadata.companyName ?? metadata.empresa, 200);
  const contact = clean(metadata.contact ?? metadata.contactName ?? metadata.contacto, 200);
  const current = state[String(ticketId)] || {};
  if (!company && !contact) return current;
  state[String(ticketId)] = { ...current, ...(company ? { company } : {}), ...(contact ? { contact } : {}) };
  await saveState(state);
  return state[String(ticketId)];
};
