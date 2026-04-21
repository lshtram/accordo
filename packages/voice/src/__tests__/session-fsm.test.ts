import { describe, it, expect } from "vitest";
import { SessionFsm } from "../core/fsm/session-fsm.js";

describe("SessionFsm", () => {
  it("M50-FSM-10: starts in inactive state", () => {
    const fsm = new SessionFsm();
    expect(fsm.state).toBe("inactive");
  });

  it("M50-FSM-11: enable transitions inactive → active and is idempotent", () => {
    const fsm = new SessionFsm();

    fsm.enable();
    fsm.enable();

    expect(fsm.state).toBe("active");
  });

  it("M50-FSM-12: disable transitions active → inactive and is idempotent", () => {
    const fsm = new SessionFsm();
    fsm.enable();

    fsm.disable();
    fsm.disable();

    expect(fsm.state).toBe("inactive");
  });

  it("M50-FSM-13/14: pushToTalkStart and pushToTalkEnd transition via suspended", () => {
    const fsm = new SessionFsm();
    fsm.enable();

    fsm.pushToTalkStart();
    expect(fsm.state).toBe("suspended");

    fsm.pushToTalkEnd();
    expect(fsm.state).toBe("active");
  });

  it("M50-FSM-16/17: updatePolicy merges partial and policy getter returns copy", () => {
    const fsm = new SessionFsm();

    fsm.updatePolicy({ language: "fr-FR", speed: 1.25 });
    const policy = fsm.policy;
    expect(policy.language).toBe("fr-FR");
    expect(policy.speed).toBe(1.25);

    policy.language = "de-DE";
    expect(fsm.policy.language).toBe("fr-FR");
  });
});
