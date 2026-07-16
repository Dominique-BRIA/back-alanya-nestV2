import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
export class ResetPasswordDto {
  @IsEmail() @Transform(({ value }) => value?.trim().toLowerCase()) email: string;
  @Matches(/^\d{6}$/) code: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
}
