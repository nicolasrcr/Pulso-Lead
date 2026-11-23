import { describe } from "vitest";
import { runCarrierContract } from "../src/carrier-contract";
import { FakeCarrierAdapter } from "../src/fake-carrier";

// A mesma suíte deve rodar para a J&T (com sandbox) e para qualquer transportadora futura.
describe("CarrierAdapter — contrato", () => {
  runCarrierContract("FakeCarrier", () => new FakeCarrierAdapter());
});
