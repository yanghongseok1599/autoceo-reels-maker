import { NextResponse } from "next/server";
import { createId } from "@/lib/mock-jobs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const photo = formData.get("photo");

  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "사진 파일이 필요합니다." }, { status: 400 });
  }

  if (!["image/jpeg", "image/png"].includes(photo.type)) {
    return NextResponse.json({ error: "JPG 또는 PNG 파일만 업로드할 수 있습니다." }, { status: 400 });
  }

  if (photo.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "사진은 최대 10MB까지 업로드할 수 있습니다." }, { status: 400 });
  }

  if (!process.env.HEYGEN_API_KEY) {
    return NextResponse.json({
      avatarId: createId("mock_avatar"),
      mode: "mock",
    });
  }

  return NextResponse.json(
    {
      error: "HeyGen Photo Avatar 실연동은 API 계약 확인 후 연결해야 합니다.",
    },
    { status: 501 },
  );
}
