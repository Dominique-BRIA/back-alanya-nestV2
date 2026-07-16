import { IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';
export class RegisterDto {
  @IsEmail({}, { message: 'Email invalide' })
  @Transform(({ value }) => value?.trim().toLowerCase())
  email: string;
}
