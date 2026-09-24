import assert from "node:assert/strict";
import test from "node:test";
import { eventEndsAt, requireActiveEvent } from "./api/_shared.js";

test("мероприятие принимает игроков до восьми часов и закрывается ровно на границе", () => {
  const createdAt = "2026-09-24T09:00:00.000Z";
  const expiresAt = Date.parse("2026-09-24T17:00:00.000Z");
  assert.equal(eventEndsAt(createdAt), expiresAt);

  const originalNow = Date.now;
  try {
    Date.now = () => expiresAt - 1;
    assert.doesNotThrow(() => requireActiveEvent(createdAt));
    Date.now = () => expiresAt;
    assert.throws(() => requireActiveEvent(createdAt), (error) =>
      error.status === 410 && error.publicMessage === "Мероприятие завершено.");
  } finally {
    Date.now = originalNow;
  }
});
