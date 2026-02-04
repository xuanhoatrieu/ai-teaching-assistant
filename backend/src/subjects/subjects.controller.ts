import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
} from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('subjects')
@UseGuards(JwtAuthGuard)
export class SubjectsController {
    constructor(private readonly subjectsService: SubjectsService) { }

    @Post()
    create(
        @CurrentUser() user: { id: string },
        @Body() dto: CreateSubjectDto,
    ) {
        return this.subjectsService.create(user.id, dto);
    }

    @Get()
    findAll(@CurrentUser() user: { id: string }) {
        return this.subjectsService.findAll(user.id);
    }

    @Get(':id')
    findOne(
        @Param('id') id: string,
        @CurrentUser() user: { id: string },
    ) {
        return this.subjectsService.findOne(id, user.id);
    }

    @Put(':id')
    update(
        @Param('id') id: string,
        @CurrentUser() user: { id: string },
        @Body() dto: UpdateSubjectDto,
    ) {
        return this.subjectsService.update(id, user.id, dto);
    }

    @Delete(':id')
    remove(
        @Param('id') id: string,
        @CurrentUser() user: { id: string },
    ) {
        return this.subjectsService.remove(id, user.id);
    }
}
