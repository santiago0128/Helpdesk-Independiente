import "dotenv/config";
import { createUser } from "../src/userAuth.js";

const [, , email, password, name = email, role = "ADMIN"] = process.argv;
if (!email || !password) {
  console.error("Uso: npm run user -- correo contraseña nombre [ADMIN|AGENT]");
  process.exit(1);
}
console.log(JSON.stringify(await createUser({ email, password, name, role }), null, 2));
