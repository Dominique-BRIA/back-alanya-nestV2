import { IsString, MinLength, MaxLength, IsOptional, IsInt, IsPositive } from 'class-validator';
export class SetupDto {
  @IsString() @MinLength(2) @MaxLength(100) pseudo: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) nom?: string;
  @IsOptional() @IsInt() @IsPositive() idPays?: number;
}
