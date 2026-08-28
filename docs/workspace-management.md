# Workspace Management Guide

This guide describes how to create workspaces, manage workspace settings, view workspace members, manage roles, and invite or remove members in BigMind.

## Creating a Workspace

1. Open the **Workspace Switcher** located in the navigation sidebar.
2. Click **+ Create Workspace** at the bottom of the workspace list.
3. In the modal dialog, enter the required fields:
   - **Workspace Name**: Required, 3 to 100 characters (leading/trailing whitespace is trimmed).
   - **Description**: Optional text describing the workspace purpose.
4. Click **Create Workspace**.
5. Upon successful creation:
   - The workspace is created transactionally and you are automatically assigned as the `OWNER`.
   - The new workspace is selected as your active workspace.
   - You are navigated to the workspace root displaying the empty state (*"No notes yet"*).

---

## Accessing Workspace Settings

1. Navigate to the main navigation menu in the BigMind Web Application.
2. Click on **Settings** or select **Workspace Settings**.
3. The Settings interface will display:
   - Current Workspace Name and your active role.
   - Tabs for **Members** and **Invitations**.

---

## Workspace Members List

Under the **Members** tab, all current members of the workspace are listed with the following details:

- **Email Address**: The registered user email.
- **Role Badge**: Indicates whether the member is an `OWNER`, `EDITOR`, or `VIEWER`.
- **Join Date**: The date when the user joined the workspace.

---

## Managing Workspace Members (OWNER only)

### Changing Member Roles
1. Locate the target member in the **Members** list.
2. Select the desired role from the role dropdown (`OWNER`, `EDITOR`, or `VIEWER`).
3. If demoting an `OWNER` to another role, a confirmation dialog will prompt you to confirm the action.
4. Note: If the target member is the sole `OWNER` of the workspace, the role cannot be changed until another member is promoted to `OWNER`.

### Removing a Member
1. Click the **Remove** button next to the member's details.
2. A confirmation dialog will ask: *"Are you sure you want to remove this member from the workspace?"*
3. Confirming the action removes the member's access to the workspace immediately.
4. Note: The last remaining `OWNER` of a workspace cannot be removed.

---

## Deleting a Workspace (OWNER only)

1. Navigate to **Settings** → **About** tab.
2. Click the **Delete Workspace** button.
3. A confirmation dialog appears requiring you to type `DELETE` exactly.
4. Click the **Delete Workspace** button to confirm.

**Deletion rules:**
- Only `OWNER` can delete a workspace.
- **Personal Workspaces** (automatically created during registration) cannot be deleted.
- Workspaces with other members cannot be deleted. Remove all members first.
- The workspace, all memberships, and invitations are permanently deleted.
- Notes, categories, and links owned by the workspace are also deleted (database cascade).
- After deletion, you are automatically switched to another workspace if one exists.

---

## Renaming a Workspace (OWNER only)

1. Navigate to **Settings** → **About** tab.
2. Click the **Rename** button next to the workspace name.
3. Enter the new name (3–100 characters, leading/trailing whitespace is trimmed).
4. Click **Save** to confirm. The workspace ID and all existing data (notes, categories, links) remain unchanged.
5. The new name updates immediately in the workspace switcher.

---

## Permissions for Non-Owner Roles

- **EDITORs & VIEWERs**:
  - Can view the members list and their respective join dates and roles.
  - Role selection dropdowns and removal buttons are disabled or hidden.
  - Non-owners see a informational notice: *"Only workspace owners can change roles or remove members."*
