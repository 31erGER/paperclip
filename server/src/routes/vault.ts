// fork 31erGER: Company-scoped Vault HTTP routes (Obsidian-compatible knowledge base & canvas).
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  vaultCreateFolderSchema,
  vaultRenameSchema,
  vaultWriteFileSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { companyService, logActivity } from "../services/index.js";
import { vaultService, type VaultActorRole } from "../services/vault.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

function actorRoleOf(req: Parameters<typeof getActorInfo>[0]): VaultActorRole {
  return req.actor.type === "agent" ? "agent" : "board";
}

export function vaultRoutes(db: Db) {
  const router = Router();
  const svc = vaultService();
  const companies = companyService(db);

  async function resolveCompanyName(companyId: string): Promise<string | undefined> {
    const company = await companies.getById(companyId);
    return company?.name;
  }

  router.get("/companies/:companyId/vault", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const companyName = await resolveCompanyName(companyId);
    const index = await svc.getIndex(companyId, companyName);
    res.json(index);
  });

  router.get("/companies/:companyId/vault/file", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const filePath = typeof req.query.path === "string" ? req.query.path : "";
    const companyName = await resolveCompanyName(companyId);
    const doc = await svc.readFile(companyId, filePath, actorRoleOf(req), companyName);
    res.json(doc);
  });

  router.put(
    "/companies/:companyId/vault/file",
    validate(vaultWriteFileSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const companyName = await resolveCompanyName(companyId);
      const { document, created } = await svc.writeFile(
        companyId,
        req.body,
        actorRoleOf(req),
        companyName,
      );
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: created ? "vault.file_created" : "vault.file_updated",
        entityType: "company",
        entityId: companyId,
        details: { path: document.path, fileType: document.fileType, boardOnly: document.boardOnly },
      });
      res.status(created ? 201 : 200).json(document);
    },
  );

  router.post(
    "/companies/:companyId/vault/folder",
    validate(vaultCreateFolderSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const companyName = await resolveCompanyName(companyId);
      const result = await svc.createFolder(companyId, req.body.path, actorRoleOf(req), companyName);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "vault.folder_created",
        entityType: "company",
        entityId: companyId,
        details: { path: result.path },
      });
      res.status(201).json(result);
    },
  );

  router.post(
    "/companies/:companyId/vault/rename",
    validate(vaultRenameSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const companyName = await resolveCompanyName(companyId);
      const result = await svc.renameEntry(
        companyId,
        req.body.fromPath,
        req.body.toPath,
        actorRoleOf(req),
        companyName,
      );
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "vault.entry_renamed",
        entityType: "company",
        entityId: companyId,
        details: result,
      });
      res.json(result);
    },
  );

  router.delete("/companies/:companyId/vault/entry", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const entryPath = typeof req.query.path === "string" ? req.query.path : "";
    const companyName = await resolveCompanyName(companyId);
    const result = await svc.deleteEntry(companyId, entryPath, actorRoleOf(req), companyName);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "vault.entry_deleted",
      entityType: "company",
      entityId: companyId,
      details: result,
    });
    res.json(result);
  });

  router.get("/companies/:companyId/vault/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const companyName = await resolveCompanyName(companyId);
    const matches = await svc.search(companyId, q, actorRoleOf(req), companyName);
    res.json({ query: q, matches });
  });

  return router;
}
