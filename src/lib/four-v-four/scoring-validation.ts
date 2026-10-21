import { z } from "zod";
export const scoreInteger = z.number().int().min(0).max(2_147_483_647);
const index = z.number().int().min(1).max(3);
const set = z.object({ setIndex: index, homePoints: scoreInteger, awayPoints: scoreInteger }).strict();
export const scoreCommandSchema = z.object({
  requestId: z.string().uuid(), expectedVersion: z.number().int().min(0).max(2_147_483_646),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("START") }).strict(),
    z.object({ type: z.literal("POINT"), setIndex: index, side: z.enum(["home", "away"]), delta: z.union([z.literal(1), z.literal(-1)]) }).strict(),
    z.object({ type: z.literal("SET_SCORE"), setIndex: index, homePoints: scoreInteger, awayPoints: scoreInteger }).strict(),
    z.object({ type: z.literal("CONFIRM_SET"), setIndex: index }).strict(),
    z.object({ type: z.literal("SUBMIT_MATCH") }).strict(),
    z.object({ type: z.literal("CORRECT_RESULT"), sets: z.array(set).min(1).max(3) }).strict(),
  ]),
}).strict();
