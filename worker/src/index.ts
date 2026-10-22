// Worker entry: only the handler is exported here (the runtime treats every export of this file as an entry point).
import { handle, type Env } from "./assistant";

export default { fetch: (req: Request, env: Env) => handle(req, env) };
