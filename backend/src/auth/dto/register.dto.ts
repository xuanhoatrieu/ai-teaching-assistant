import { IsEmail, IsString, MinLength, IsNotEmpty } from 'class-validator';

export class RegisterDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters' })
    password: string;

    @IsString()
    @IsNotEmpty({ message: 'Full name is required' })
    fullName: string;

    @IsString()
    @IsNotEmpty({ message: 'Phone number is required' })
    phone: string;

    @IsString()
    @IsNotEmpty({ message: 'Organization is required' })
    organization: string;
}
