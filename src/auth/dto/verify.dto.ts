import { IsEmail, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
export class VerifyDto {
  @IsEmail() @Transform(({ value }) => value?.trim().toLowerCase()) email: string;
  @Matches(/^\d{6}$/, { message: 'Le code doit comporter 6 chiffres' }) code: string;
}
