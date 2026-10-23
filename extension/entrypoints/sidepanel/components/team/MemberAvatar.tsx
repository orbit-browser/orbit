import type { MemberBrief } from '../../../../lib/types';

/** 프로필 사진이 없거나 깨지면 이름 첫 글자로 대신한다. */
export function MemberAvatar({ member, size = 16 }: { member: MemberBrief; size?: number }) {
  const label = member.name ?? '팀원';
  return member.picture ? (
    <img
      src={member.picture}
      alt=""
      title={label}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className="shrink-0 rounded-full object-cover"
      onError={(event) => {
        event.currentTarget.style.display = 'none';
      }}
    />
  ) : (
    <span
      title={label}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      className="flex shrink-0 items-center justify-center rounded-full bg-orbit-primary-soft font-bold text-orbit-primary"
    >
      {label.slice(0, 1)}
    </span>
  );
}
