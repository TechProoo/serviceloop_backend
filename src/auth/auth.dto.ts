import { Transform } from 'class-transformer';
import { IsEmail, IsIn, ValidateIf, IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @Length(12, 128) password!: string;
}
export class RegisterDto extends LoginDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 100) name!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['CUSTOMER', 'OWNER']) role: 'CUSTOMER' | 'OWNER' = 'CUSTOMER';
}
export class ChangePasswordDto {
  @IsString() @Length(1, 128) currentPassword!: string;
  @IsString() @Length(12, 128) newPassword!: string;
}

