import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, ValidateIf, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';

export const CATEGORIES = ['Heavy machinery', 'Lifting equipment', 'Power & generators', 'Concrete equipment', 'Scaffolding', 'Transport'];
export const SERVICES = [
  { slug: 'equipment-operators', title: 'Equipment operators' },
  { slug: 'haulage-mobilisation', title: 'Haulage & mobilisation' },
  { slug: 'site-preparation', title: 'Site clearing & preparation' },
];
export const SERVICE_NAMES = ['Equipment rental', 'Multiple equipment & services', ...SERVICES.map(s => s.title)];
const Trim = () => Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value);
export class PageDto {
  @ValidateIf((_object, value) => value !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ValidateIf((_object, value) => value !== undefined) @Type(() => Number) @IsInt() @Min(0) @Max(1000000) offset = 0;
}
export class EquipmentQueryDto extends PageDto {
  @ValidateIf((_object, value) => value !== undefined) @Trim() @IsString() @Length(1, 150) q?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(CATEGORIES) category?: string;
  @ValidateIf((_object, value) => value !== undefined) @Trim() @IsString() @Length(1, 150) location?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['true', 'false']) available?: string;
  @ValidateIf((_object, value) => value !== undefined) @Type(() => Number) @IsInt() @Min(0) @Max(10000000) minRate?: number;
  @ValidateIf((_object, value) => value !== undefined) @Type(() => Number) @IsInt() @Min(0) @Max(10000000) maxRate?: number;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['newest', 'price_asc', 'price_desc']) sort: string = 'newest';
}
export class CreateEquipmentDto {
  @Trim() @IsString() @Length(1, 100) name!: string;
  @IsIn(CATEGORIES) category!: string;
  @Trim() @IsString() @Length(1, 150) location!: string;
  @IsInt() @Min(1000) @Max(10000000) rate!: number;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(2048) @Matches(/^(https:\/\/[^\s]+)?$/) image?: string;
  @Trim() @IsString() @Length(1, 100) capacity!: string;
  @IsBoolean() operator!: boolean;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() available?: boolean;
  @Trim() @IsString() @Length(1, 100) vendor!: string;
  @Trim() @IsString() @Length(1, 2000) description!: string;
}
export class UpdateEquipmentDto {
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() available?: boolean;
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1000) @Max(10000000) rate?: number;
}
export class ModerateEquipmentDto {
  @IsIn(['PUBLISHED', 'REJECTED']) status!: 'PUBLISHED' | 'REJECTED';
}
export class CreateRequestDto {
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) @Max(2147483647) equipmentId?: number;
  @ValidateIf((_object, value) => value !== undefined) @Trim() @IsString() @Length(1, 150) title?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(SERVICE_NAMES) service: string = 'Equipment rental';
  @Trim() @IsString() @Length(1, 150) location!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) start!: string;
  @IsInt() @Min(1) @Max(365) days!: number;
  @ValidateIf((_object, value) => value !== undefined) @Trim() @IsString() @Length(1, 100) name?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsEmail() @MaxLength(254) email?: string;
  @ValidateIf((_object, value) => value !== undefined) @Trim() @IsString() @MaxLength(2000) notes?: string;
}
export class UpdateRequestDto {
  @IsIn(['QUOTED', 'ACCEPTED', 'DECLINED', 'CANCELLED']) status!: 'QUOTED' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) @Max(10000000000) quotedAmount?: number;
  @ValidateIf((_object, value) => value !== undefined) @Trim() @IsString() @MaxLength(2000) quoteNotes?: string;
}
export class WaitlistDto {
  @ValidateIf((_object, value) => value !== undefined) @Trim() @IsEmail() @MaxLength(254) email?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsIn(['Builder / Contractor', 'Equipment Owner', 'Project Manager', 'Developer / Real Estate', 'Service Provider', 'Other']) role?: string;
  @Trim() @IsString() @Length(1, 100) name!: string;
  @Trim() @IsString() @Length(8, 25) phone!: string;
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 100, { each: true }) wantToRent: string[] = [];
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 100, { each: true }) wantToList: string[] = [];
}

