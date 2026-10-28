import "dotenv/config";
import { createStoredToken } from "../src/tickets.js";
const [, , name = "GlobalCRM", source = "global-crm", type = "INTEGRATION"] = process.argv;
console.log(JSON.stringify(await createStoredToken({ name, source, type }), null, 2));
process.exit(0);
