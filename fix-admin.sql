UPDATE users 
SET password_hash = '$2b$10$MSD2Opirp0z46SfT6JbizOLKIk3bUgZWYh8p7OO5rXG4v9ZIvmjse', 
    role = 'ADMIN',
    updated_at = NOW()
WHERE email = 'xuanhoaspt@gmail.com'
RETURNING id, email, role;
