import { IsString, MinLength } from 'class-validator';
export class LoginDto {
  @IsString() @MinLength(1, { message: 'Identifiant requis' }) identifier: string;
  @IsString() @MinLength(1, { message: 'Mot de passe requis' }) password: string;
}
