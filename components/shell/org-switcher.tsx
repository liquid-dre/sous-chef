"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";
import { useOrganizationList } from "@clerk/nextjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** For multi-kitchen members. Switching sets Clerk's active org and lands on
 * that kitchen's home — /[orgSlug] routes keep bookmarks honest. */
export function OrgSwitcher({
  currentSlug,
  currentName,
}: {
  currentSlug: string;
  currentName: string;
}) {
  const router = useRouter();
  const { userMemberships, setActive, isLoaded } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  const memberships = isLoaded ? userMemberships.data : [];
  const several = memberships.length > 1;

  if (!several) {
    return (
      <span className="type-label truncate px-2 text-foreground">
        {currentName}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 type-label text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9"
        aria-label="Switch kitchen"
      >
        <span className="truncate">{currentName}</span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {memberships.map((m) => {
          const org = m.organization;
          const active = org.slug === currentSlug;
          return (
            <DropdownMenuItem
              key={org.id}
              className={cn("min-h-11 md:min-h-8", active && "bg-muted")}
              onSelect={async () => {
                await setActive?.({ organization: org.id });
                router.push(`/${org.slug}`);
              }}
            >
              <span className="truncate">{org.name}</span>
              {active && <Check aria-hidden className="ml-auto size-4" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
