// @vitest-environment jsdom
// fork 31erGER
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@paperclipai/shared";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  environmentOptions: vi.fn(),
  isLocal: true,
}));

vi.mock("../api/projects", () => ({
  projectsApi: {
    create: mocks.createProject,
    environmentOptions: mocks.environmentOptions,
  },
}));

vi.mock("@/hooks/useDeploymentProfile", () => ({
  useDeploymentProfile: () => ({
    profile: mocks.isLocal ? "local_only" : "standard",
    isLocal: mocks.isLocal,
    showCostMetrics: !mocks.isLocal,
    loaded: true,
  }),
}));

vi.mock("./ProjectRepositoryInput", () => ({
  ProjectRepositoryInput: () => <div data-testid="project-repo-input" />,
  repositoryOptionsKey: (companyId: string) => ["repo-options", companyId],
}));

vi.mock("@/features/connections/ConnectionSetupFlow", () => ({
  ConnectionSetupFlow: () => <div />,
}));

vi.mock("../lib/recent-projects", () => ({
  trackRecentProject: vi.fn(),
}));

import { NewProjectForm } from "./NewProjectDialog";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
  mocks.isLocal = true;
  mocks.environmentOptions.mockResolvedValue({
    defaultEnvironmentId: "env-local",
    groups: [
      {
        storageProviderPluginId: null,
        environments: [{ id: "env-local", name: "Local" }],
      },
    ],
    error: null,
  });
  mocks.createProject.mockResolvedValue({
    id: "proj-1",
    companyId: "comp-1",
    name: "Demo Project",
  } as Project);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("NewProjectForm (local folder)", () => {
  it("omits repositoryIds when creating a project with a local project folder", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NewProjectForm companyId="comp-1" onClose={onClose} />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const nameInput = document.body.querySelector<HTMLInputElement>('input[aria-label="Project name"]');
    const folderInput = document.body.querySelector<HTMLInputElement>('input[aria-label="Project folder"]');
    const form = document.body.querySelector("form");
    expect(nameInput).not.toBeNull();
    expect(folderInput).not.toBeNull();
    expect(form).not.toBeNull();

    // In local mode, GitHub repository picker should not be shown alongside required local folder.
    expect(document.body.querySelector('[data-testid="project-repo-input"]')).toBeNull();

    await act(async () => {
      setNativeInputValue(nameInput!, "Demo Project");
      setNativeInputValue(folderInput!, "/tmp/demo-project");
    });

    await act(async () => {
      form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(mocks.createProject).toHaveBeenCalledTimes(1);
    const [companyId, payload] = mocks.createProject.mock.calls[0]!;
    expect(companyId).toBe("comp-1");
    expect(payload.workspace).toEqual({
      name: "Project folder",
      sourceType: "local_path",
      cwd: "/tmp/demo-project",
      isPrimary: true,
    });
    expect("repositoryIds" in payload).toBe(false);
  });
});
