import { prisma } from '../../shared/prisma.js'
import { logger } from '../../shared/logger.js'

type SelectionResult = {
  newlySelectedIds: string[]
  replacedIds: string[]
  stillActiveIds: string[]
}

export class SubSelectionService {
  public async runSelection(occurrenceId: string): Promise<SelectionResult> {
    const occurrence = await prisma.sessionOccurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        session: true,
        registrations: { where: { status: 'ATTENDING' } },
        subSignups: { orderBy: { createdAt: 'asc' } }
      }
    })

    if (!occurrence) {
      throw new Error('Session occurrence missing')
    }

    const capacity = occurrence.session.capacity ?? 0
    const attendingCount = occurrence.registrations.length
    const openSlots = Math.max(capacity - attendingCount, 0)

    const activeSignups = occurrence.subSignups.filter((signup) => signup.status === 'ACTIVE' || signup.status === 'SELECTED')
    const selected = activeSignups.slice(0, openSlots)
    const overflow = activeSignups.slice(openSlots)

    const selectedIds = selected.map((signup) => signup.id)
    const overflowIds = overflow.map((signup) => signup.id)

    const previouslySelectedIds = occurrence.subSignups.filter((signup) => signup.status === 'SELECTED').map((signup) => signup.id)
    const previouslySelectedIdSet = new Set(previouslySelectedIds)
    const replacedIds = previouslySelectedIds.filter((id) => !selectedIds.includes(id))
    const newlySelectedIds = selectedIds.filter((id) => !previouslySelectedIdSet.has(id))

    if (newlySelectedIds.length > 0) {
      await prisma.subSignup.updateMany({
        where: { id: { in: newlySelectedIds } },
        data: {
          status: 'SELECTED',
          selectedAt: new Date()
        }
      })
    }

    if (overflowIds.length > 0) {
      await prisma.subSignup.updateMany({
        where: { id: { in: overflowIds }, status: 'SELECTED' },
        data: {
          status: 'ACTIVE',
          selectedAt: null
        }
      })
    }

    if (replacedIds.length > 0) {
      await prisma.subSignup.updateMany({
        where: { id: { in: replacedIds } },
        data: {
          status: 'REPLACED'
        }
      })
    }

    const rankUpdates = activeSignups.map((signup, index) => {
      return prisma.subSignup.update({
        where: { id: signup.id },
        data: { selectionRank: index + 1 }
      })
    })

    if (rankUpdates.length > 0) {
      await prisma.$transaction(rankUpdates)
    }

    logger.info(
      {
        occurrenceId,
        openSlots,
        selectedCount: selectedIds.length,
        newlySelectedCount: newlySelectedIds.length,
        replacedCount: replacedIds.length
      },
      'Sub selection completed'
    )

    return {
      newlySelectedIds,
      replacedIds,
      stillActiveIds: overflowIds
    }
  }
}
