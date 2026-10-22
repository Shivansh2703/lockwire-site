// Worker entry: only the handler and the Durable Object class are exported here (the runtime treats every export of this file as an entry point).
import { handle, type Env } from "./assistant";
import { handleHits } from "./hits";

export { Counter } from "./hits";

export default { fetch: async (req: Request, env: Env) => (await handleHits(req, env)) ?? handle(req, env) };
