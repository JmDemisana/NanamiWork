import { expect, test } from "bun:test";
import { useStudyStore } from "../src/react-app/domains/study/study-store";

test("model choices and variants belong to their notebook", () => {
  useStudyStore.setState({ notebooks: [] });
  const first = useStudyStore.getState().createNotebook("First");
  const second = useStudyStore.getState().createNotebook("Second");
  const model = { providerID: "example", modelID: "model-one" };
  useStudyStore.getState().setNotebookModel(first.id, model, "high");
  let notebooks = useStudyStore.getState().notebooks;
  expect(notebooks.find((item) => item.id === first.id)?.model).toEqual(model);
  expect(notebooks.find((item) => item.id === first.id)?.modelVariant).toBe("high");
  expect(notebooks.find((item) => item.id === second.id)?.model).toBeNull();
  useStudyStore.getState().setNotebookModel(first.id, { providerID: "example", modelID: "model-two" });
  notebooks = useStudyStore.getState().notebooks;
  expect(notebooks.find((item) => item.id === first.id)?.modelVariant).toBeNull();
});
