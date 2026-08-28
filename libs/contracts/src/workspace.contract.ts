import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const contract = initContract();

export const workspaceRoleSchema = z.enum(['OWNER', 'EDITOR', 'VIEWER']);

export const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  role: workspaceRoleSchema,
});

export const workspaceMemberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  role: workspaceRoleSchema,
  joinedAt: z.string(),
});

export const listMembersResponseSchema = z.array(workspaceMemberSchema);

export const listWorkspacesResponseSchema = z.array(workspaceSchema);



const errorResponseSchema = z.object({
  message: z.string(),
});

export const invitationSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  email: z.string().email(),
  role: workspaceRoleSchema,
  token: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const listInvitationsResponseSchema = z.array(invitationSchema);

const inviteRequestSchema = z.object({
  email: z.string().email().max(255),
  role: z.enum(['EDITOR', 'VIEWER']),
});

const acceptRequestSchema = z.object({
  token: z.string().min(1),
});

export const createWorkspaceRequestSchema = z.object({
  name: z
    .string()
    .transform((val) => val.trim())
    .pipe(
      z
        .string()
        .min(3, 'Workspace name must be at least 3 characters')
        .max(100, 'Workspace name must be at most 100 characters'),
    ),
  description: z
    .string()
    .transform((val) => val.trim())
    .nullable()
    .optional(),
});

const renameRequestSchema = z.object({
  name: z
    .string()
    .transform((val) => val.trim())
    .pipe(
      z
        .string()
        .min(3, 'Workspace name must be at least 3 characters')
        .max(100, 'Workspace name must be at most 100 characters'),
    ),
});

export const workspaceContract = contract.router(
  {
    create: {
      method: 'POST',
      path: '/workspaces',
      body: createWorkspaceRequestSchema,
      responses: {
        201: workspaceSchema,
        400: errorResponseSchema,
      },
      summary: 'Create a new workspace',
    },
    list: {
      method: 'GET',
      path: '/workspaces',
      responses: {
        200: listWorkspacesResponseSchema,
      },
      summary: 'List workspaces available to the authenticated user',
    },
    listMembers: {
      method: 'GET',
      path: '/workspaces/:workspaceId/members',
      pathParams: z.object({
        workspaceId: z.string().uuid(),
      }),
      responses: {
        200: listMembersResponseSchema,
        403: errorResponseSchema,
      },
      summary: 'List members of a workspace (any member)',
    },
    changeMemberRole: {
      method: 'PATCH',
      path: '/workspaces/:workspaceId/members/:userId',
      pathParams: z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
      }),
      body: z.object({
        role: z.enum(['OWNER', 'EDITOR', 'VIEWER']),
      }),
      responses: {
        200: workspaceMemberSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
      },
      summary: 'Change a member role (OWNER only)',
    },
    removeMember: {
      method: 'DELETE',
      path: '/workspaces/:workspaceId/members/:userId',
      pathParams: z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
      }),
      responses: {
        200: z.object({ message: z.string() }),
        403: errorResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
      },
      summary: 'Remove a member from a workspace (OWNER only)',
    },
    delete: {
      method: 'DELETE',
      path: '/workspaces/:workspaceId',
      pathParams: z.object({
        workspaceId: z.string().uuid(),
      }),
      responses: {
        200: z.object({ message: z.string() }),
        403: errorResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
      },
      summary: 'Delete a workspace (OWNER only, personal WS cannot be deleted, must have no other members)',
    },
    rename: {
      method: 'PATCH',
      path: '/workspaces/:workspaceId/rename',
      pathParams: z.object({
        workspaceId: z.string().uuid(),
      }),
      body: renameRequestSchema,
      responses: {
        200: workspaceSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
      summary: 'Rename a workspace (OWNER only)',
    },
    listInvitations: {
      method: 'GET',
      path: '/workspaces/:workspaceId/invitations',
      pathParams: z.object({
        workspaceId: z.string().uuid(),
      }),
      responses: {
        200: listInvitationsResponseSchema,
        403: errorResponseSchema,
      },
      summary: 'List invitations for a workspace (OWNER only)',
    },
    createInvitation: {
      method: 'POST',
      path: '/workspaces/:workspaceId/invitations',
      pathParams: z.object({
        workspaceId: z.string().uuid(),
      }),
      body: inviteRequestSchema,
      responses: {
        201: invitationSchema,
        403: errorResponseSchema,
        409: errorResponseSchema,
      },
      summary: 'Invite a user to a workspace (OWNER only)',
    },
    revokeInvitation: {
      method: 'DELETE',
      path: '/workspaces/:workspaceId/invitations/:invitationId',
      pathParams: z.object({
        workspaceId: z.string().uuid(),
        invitationId: z.string().uuid(),
      }),
      responses: {
        200: z.object({ message: z.string() }),
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
      summary: 'Revoke a workspace invitation (OWNER only)',
    },
    getInvitation: {
      method: 'GET',
      path: '/workspace-invitations/:token',
      pathParams: z.object({
        token: z.string(),
      }),
      responses: {
        200: invitationSchema,
        404: errorResponseSchema,
      },
      summary: 'Get invitation details by token (public, no auth)',
    },
    acceptInvitation: {
      method: 'POST',
      path: '/workspace-invitations/accept',
      body: acceptRequestSchema,
      responses: {
        200: invitationSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
      },
      summary: 'Accept a workspace invitation (authenticated)',
    },
  },
  {
    strictStatusCodes: true,
    validateResponseOnClient: true,
  },
);