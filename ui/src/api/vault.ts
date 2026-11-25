// fork 31erGER: Company Vault API client.
import type {
  VaultDocument,
  VaultIndexResponse,
  VaultSearchMatch,
  VaultWriteFileInput,
} from "@paperclipai/shared";
import { api } from "./client";

export const vaultApi = {
  getIndex: (companyId: string) =>
    api.get<VaultIndexResponse>(`/companies/${encodeURIComponent(companyId)}/vault`),

  readFile: (companyId: string, path: string) =>
    api.get<VaultDocument>(
      `/companies/${encodeURIComponent(companyId)}/vault/file?path=${encodeURIComponent(path)}`,
    ),

  writeFile: (companyId: string, input: VaultWriteFileInput) =>
    api.put<VaultDocument>(`/companies/${encodeURIComponent(companyId)}/vault/file`, input),

  createFolder: (companyId: string, path: string) =>
    api.post<{ path: string }>(`/companies/${encodeURIComponent(companyId)}/vault/folder`, {
      path,
    }),

  renameEntry: (companyId: string, fromPath: string, toPath: string) =>
    api.post<{ fromPath: string; toPath: string }>(
      `/companies/${encodeURIComponent(companyId)}/vault/rename`,
      { fromPath, toPath },
    ),

  deleteEntry: (companyId: string, path: string) =>
    api.delete<{ path: string; kind: "file" | "folder" }>(
      `/companies/${encodeURIComponent(companyId)}/vault/entry?path=${encodeURIComponent(path)}`,
    ),

  search: (companyId: string, q: string) =>
    api.get<{ query: string; matches: VaultSearchMatch[] }>(
      `/companies/${encodeURIComponent(companyId)}/vault/search?q=${encodeURIComponent(q)}`,
    ),
};
