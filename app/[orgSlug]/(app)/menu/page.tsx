import { requireOrgPage } from "../_lib/stub-page";
import { MenuListContainer } from "@/components/menu/menu-list-container";
import { StaffMenuList } from "@/components/menu/staff-menu-list";

/**
 * Menu is in the staff nav, but costs and margins are owner-only. The role
 * decides which component mounts — and therefore which query runs — so
 * staff never fetch a cost, let alone render one.
 */
export default async function MenuPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const access = await requireOrgPage(params);
  return access.role === "owner" ? (
    <MenuListContainer orgSlug={access.slug} />
  ) : (
    <StaffMenuList orgSlug={access.slug} />
  );
}
