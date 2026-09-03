/** Registers ts-resolver.mjs. Used via `node --import` in the `test` script. */
import { register } from "node:module";
register("./ts-resolver.mjs", import.meta.url);
