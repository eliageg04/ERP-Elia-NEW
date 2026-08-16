// Wird vor jedem Testfile geladen: Test-Datenbank verwenden,
// bevor der Prisma-Client instanziiert wird.
process.env.DATABASE_URL = "file:./test.db";
