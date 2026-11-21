import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common"
import { ApiOperation, ApiTags } from "@nestjs/swagger"

import { MarkStaffNotificationsBody, StaffNotificationPage, StaffNotificationQuery, StaffNotificationSummary } from "@unitravel/contracts"

import { AppError } from "../../core/errors"
import { type Actor, Authenticated, CurrentActor, StaffOnly } from "../../core/http/decorators"
import { ApiZodResponse, zbody } from "../../core/http/zod"
import { StaffFeedService } from "./staff-feed.service"

/** ADR-0039 D1: the signed-in staff member's own feed. Rows are always filtered by the caller's user id. */
@ApiTags("staff-notifications")
@Controller("v1/admin/notifications")
@StaffOnly()
export class StaffNotificationsController {
  constructor(private readonly feed: StaffFeedService) {}

  private staff(actor: Actor) {
    if (!actor.isStaff) throw new AppError("FORBIDDEN", "Staff only")
    return actor.userId
  }

  @Get()
  @Authenticated()
  @ApiOperation({ summary: "My staff notifications, newest first (category and unread filters, `before` cursor)" })
  @ApiZodResponse(200, StaffNotificationPage)
  list(@Query(zbody(StaffNotificationQuery)) q: StaffNotificationQuery, @CurrentActor() actor: Actor) {
    return this.feed.list(this.staff(actor), q)
  }

  @Get("summary")
  @Authenticated()
  @ApiOperation({ summary: "Unread counts per category, for the sidebar badges and the bell" })
  @ApiZodResponse(200, StaffNotificationSummary)
  summary(@CurrentActor() actor: Actor) {
    return this.feed.summary(this.staff(actor))
  }

  @Post("read")
  @Authenticated()
  @HttpCode(200)
  @ApiOperation({ summary: "Mark my notifications read: exactly one of ids, all, category or ref" })
  read(@Body(zbody(MarkStaffNotificationsBody)) body: MarkStaffNotificationsBody, @CurrentActor() actor: Actor) {
    return this.feed.markRead(this.staff(actor), body)
  }
}
