# Workspace Permissions & Role Matrix

This document defines the Role-Based Access Control (RBAC) model used within BigMind workspaces.

## Roles Overview

Each workspace member has one of three assigned roles:

- **OWNER**: Full administrative control over the workspace, including member management, invitations, workspace settings, and full content access.
- **EDITOR**: Content management capabilities. Editors can create, read, update, and delete notes, categories, and links, but cannot manage workspace members or settings.
- **VIEWER**: Read-only access to workspace content. Viewers cannot modify notes or categories and cannot manage workspace members or settings.

---

## Role Matrix

| Action / Capability | OWNER | EDITOR | VIEWER |
| :--- | :---: | :---: | :---: |
| **Create New Workspace** | ✅ (Any Auth User) | ✅ (Any Auth User) | ✅ (Any Auth User) |
| **View Workspace Content** (Notes, Categories, Links) | ✅ | ✅ | ✅ |
| **Create / Edit / Delete Content** | ✅ | ✅ | ❌ |
| **View Workspace Settings & Members List** | ✅ | ✅ | ✅ |
| **Invite New Members** | ✅ | ❌ | ❌ |
| **Change Member Roles** (OWNER, EDITOR, VIEWER) | ✅ | ❌ | ❌ |
| **Remove Members from Workspace** | ✅ | ❌ | ❌ |
| **Delete Workspace** | ✅ | ❌ | ❌ |
| **Rename Workspace** | ✅ | ❌ | ❌ |

---

## Member Management Rules & Protection Constraints

1. **Owner Exclusivity for Administrative Tasks**:
   - Only members with the `OWNER` role can invite new users, change roles, or remove members.
   - Any API request to change roles or remove members performed by an `EDITOR` or `VIEWER` is rejected with `403 Forbidden`.

2. **Last OWNER Protection**:
   - A workspace must always have at least one active `OWNER`.
   - Attempting to remove the sole remaining `OWNER` of a workspace will fail with `409 Conflict`.
   - Attempting to demote the sole remaining `OWNER` to `EDITOR` or `VIEWER` will fail with `409 Conflict`.
   - To transfer ownership or step down as owner, another member must first be promoted to `OWNER`.

3. **Confirmation Guards**:
   - Web UI interactions for role demotions or member removals require explicit user confirmation via dialogs.

4. **Workspace Deletion Constraints**:
   - Only `OWNER` can delete a workspace.
   - **Personal Workspaces** (created automatically during registration, identified by the `[email] Personal Workspace` naming pattern) cannot be deleted.
   - Workspaces containing other members besides the requesting owner cannot be deleted. All other members must be removed first.
   - Web UI requires typing `DELETE` in a confirmation dialog before the workspace can be deleted.
