// src/lib/session-cookie.ts
// Solo el nombre de la cookie de sesion, sin nada mas. Existe como
// archivo propio para que middleware.ts (Edge Runtime) pueda importarlo
// sin arrastrar el resto de auth.ts (Prisma, bcrypt, React.cache), que no
// son compatibles con Edge.
export const SESSION_COOKIE = 'cofre_session';
