/**
 * A tab's count badge shows only when there's a positive count to report; a
 * zero or missing count renders no badge (keeps the Wire Log tab, which has no
 * count, badge-free and hides the Scenarios badge when the lane has none).
 */
export function shouldShowTabBadge(count: number | undefined): boolean {
  return count !== undefined && count > 0;
}
