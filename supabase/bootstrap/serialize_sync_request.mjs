import { readFileSync } from "node:fs";
import { serializeWorkoutSyncRequest } from "../functions/_shared/workoutSyncRoute.ts";

const input = JSON.parse(readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(serializeWorkoutSyncRequest(input)));
