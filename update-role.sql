UPDATE "User" SET role = 'ADMIN' WHERE email = 'testadmin@test.com' RETURNING id, email, role;
