"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, DatabaseZap, LogOut, Users } from "lucide-react";

import { logoutAction } from "@/lib/auth/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UserMenuProps {
  name: string;
  email: string;
  /** Muestra "Usuarios y roles" (solo admin). */
  esAdmin: boolean;
}

export function UserMenu({ name, email, esAdmin }: UserMenuProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  function handleLogout() {
    startTransition(async () => {
      await logoutAction();
      router.push("/login", { transitionTypes: ["auth-exit"] });
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-2"
          aria-label="Menú de usuario"
        >
          <Avatar className="h-7 w-7">
            <AvatarFallback>{initials || "U"}</AvatarFallback>
          </Avatar>
          <span className="hidden text-left text-sm leading-tight md:flex md:flex-col">
            <span className="font-medium">{name}</span>
            <span className="text-xs text-muted-foreground">{email}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link href="/documentacion" className="flex w-full cursor-pointer items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Documentación
          </Link>
        </DropdownMenuItem>
        {esAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin/usuarios" className="flex w-full cursor-pointer items-center gap-2">
              <Users className="h-4 w-4" />
              Usuarios y roles
            </Link>
          </DropdownMenuItem>
        )}
        {esAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin/suiteql" className="flex w-full cursor-pointer items-center gap-2">
              <DatabaseZap className="h-4 w-4" />
              Consola SuiteQL
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Sesión</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <button
            type="button"
            onClick={handleLogout}
            disabled={pending}
            className="flex w-full cursor-pointer items-center gap-2 text-left"
          >
            <LogOut className="h-4 w-4" />
            {pending ? "Cerrando sesión…" : "Cerrar sesión"}
          </button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}