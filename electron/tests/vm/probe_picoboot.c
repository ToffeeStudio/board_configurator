/* Freestanding x86-64 Linux guest probe. It refuses any device without the
 * synthetic ROM serial. It verifies a write to mock flash and reboots. */
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;

static long syscall3(long nr, long a, long b, long c) {
    long result;
    __asm__ volatile("syscall" : "=a"(result) : "a"(nr), "D"(a), "S"(b), "d"(c) : "rcx", "r11", "memory");
    return result;
}

__attribute__((noreturn)) static void finish(int code) {
    syscall3(60, code, 0, 0);
    __builtin_unreachable();
}

#define MEM_IO(nr, type) (0xc0005500UL | (sizeof(type) << 16) | (nr))

struct control {
    u8 type, request;
    u16 value, index, length;
    u32 timeout;
    void *data;
};

struct bulk {
    u32 endpoint, count, timeout;
    void *data;
};

struct command {
    u32 magic, token;
    u8 code, size;
    u16 zero;
    u32 length, argument[4];
};

static long fd;

static long control(u8 type, u8 request, u16 value, u16 index, u16 length, void *data) {
    struct control transfer = {type, request, value, index, length, 1500, data};
    return syscall3(16, fd, MEM_IO(0, struct control), (long)&transfer);
}

static long bulk(u32 endpoint, u32 length, void *data) {
    struct bulk transfer = {endpoint, length, 1500, data};
    return syscall3(16, fd, MEM_IO(2, struct bulk), (long)&transfer);
}

static void exchange(struct command cmd, u8 *data) {
    static u32 token;
    u32 status[4];
    u8 ack = 0;
    cmd.magic = 0x431fd10b;
    cmd.token = ++token;
    if (bulk(3, sizeof(cmd), &cmd) != sizeof(cmd)) finish(10 + token);
    if (cmd.code & 0x80) {
        if (bulk(0x84, cmd.length, data) != cmd.length || bulk(3, 1, &ack) != 1) finish(20 + token);
    } else {
        if (cmd.length && bulk(3, cmd.length, data) != cmd.length) finish(30 + token);
        if (bulk(0x84, 1, &ack) != 0) finish(30 + token);
    }
    // The device disconnects after acknowledging REBOOT.
    if (cmd.code != 2 && (control(0xc1, 0x42, 0, 1, sizeof(status), status) != sizeof(status) ||
        status[0] != token || status[1] != 0 || status[2] != cmd.code)) finish(40 + token);
}

__attribute__((used, noreturn)) static void entry(long *initial_stack) {
    if (initial_stack[0] != 2) finish(1);
    fd = syscall3(2, initial_stack[2], 2, 0); // open(argv[1], O_RDWR)
    if (fd < 0) finish(2);
    const char serial[] = "TOFFEEVMROM1";
    u8 descriptor[26], bytes[256];
    if (control(0x80, 6, 0x0303, 0x0409, sizeof(descriptor), descriptor) != sizeof(descriptor)) finish(3);
    if (descriptor[0] != sizeof(descriptor) || descriptor[1] != 3) finish(4);
    for (unsigned i = 0; i < sizeof(serial) - 1; i++) {
        if (descriptor[2 + 2 * i] != serial[i] || descriptor[3 + 2 * i] != 0) finish(4);
    }
    const u32 iface = 1;
    if (syscall3(16, fd, 0x8004550f, (long)&iface) || control(0x41, 0x41, 0, 1, 0, 0)) finish(5);
    exchange((struct command){.code = 1, .size = 1, .argument = {1}}, 0);
    exchange((struct command){.code = 6}, 0);
    exchange((struct command){.code = 7}, 0);
    exchange((struct command){.code = 0x84, .size = 8, .length = sizeof(bytes),
        .argument = {0x10000000, sizeof(bytes)}}, bytes);
    for (unsigned i = 0; i < sizeof(bytes); i++) {
        if (bytes[i] != 0x5a) finish(6);
    }
    u8 sector[4096], readback[4096];
    const struct command read_sector = {.code = 0x84, .size = 8, .length = sizeof(sector),
        .argument = {0x10000000, sizeof(sector)}};
    exchange(read_sector, sector);
    sector[0] = 0x42;
    exchange((struct command){.code = 6}, 0);
    exchange((struct command){.code = 3, .size = 8, .argument = {0x10000000, sizeof(sector)}}, 0);
    exchange((struct command){.code = 5, .size = 8, .length = sizeof(sector),
        .argument = {0x10000000, sizeof(sector)}}, sector);
    exchange((struct command){.code = 7}, 0);
    exchange(read_sector, readback);
    for (unsigned i = 0; i < sizeof(sector); i++) {
        if (readback[i] != sector[i]) finish(7);
    }
    exchange((struct command){.code = 2, .size = 12, .argument = {0, 0, 500}}, 0);
    finish(0);
}

__asm__(".global _start\n_start:\n mov %rsp,%rdi\n call entry\n");
