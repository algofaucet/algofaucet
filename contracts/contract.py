from pyteal import *

# Constants
CLAIM_AMOUNT_DEFAULT = Int(2_000)
BLOCK_INTERVAL_DEFAULT = Int(10_000)
MIN_FEE = Int(1000)
MIN_BALANCE = Int(100_000)
BOX_SIZE = Int(8)
CONFIG_FEE = Int(8_000)
DELETE_LSIG_ADDR = Addr("77DOC6HTCDKUJSX2D37UVWSTIFN3TC3RA5P3C3A6C7BJW6WYID2MGT7WUI")
KEY_CLAIM_AMOUNT = Bytes("claim_amount")
KEY_BLOCK_INTERVAL = Bytes("block_interval")

@Subroutine(TealType.bytes)
def target_account() -> Expr:
    return Txn.sender()

@Subroutine(TealType.none)
def check_payment_in_group(amount: Expr, receiver: Expr) -> Expr:
    """Require group size 2 and that the other tx is Payment of amount to receiver from sender."""
    other_idx = If(Txn.group_index() == Int(0), Int(1), Int(0))
    return Seq([
        Assert(Global.group_size() == Int(2), comment="Group size must be 2"),
        Assert(
            And(
                Gtxn[other_idx].type_enum() == TxnType.Payment,
                Gtxn[other_idx].amount() == amount,
                Gtxn[other_idx].receiver() == receiver,
                Gtxn[other_idx].sender() == Txn.sender()
            ),
            comment="Payment of required amount to required receiver from sender required"
        ),
    ])

@Subroutine(TealType.none)
def check_and_create_box() -> Expr:
    box_name = target_account()
    return Seq([
        box_len := BoxLen(box_name),
        If(Not(box_len.hasValue()))
        .Then(
            Assert(BoxCreate(box_name, BOX_SIZE)),
            BoxPut(box_name, Itob(Int(0)))
        )
    ])

@Subroutine(TealType.uint64)
def get_last_claim_block() -> Expr:
    box_name = target_account()
    return Seq([
        box_len := BoxLen(box_name),
        If(Not(box_len.hasValue()))
        .Then(Int(0))
        .Else(
            box_value := BoxGet(box_name),
            Btoi(box_value.value())
        )
    ])

@Subroutine(TealType.none)
def update_last_claim_block() -> Expr:
    box_name = target_account()
    return BoxPut(box_name, Itob(Txn.first_valid()))

@Subroutine(TealType.none)
def verify_claim_conditions(claim_amount: Expr) -> Expr:
    return Seq([
        Assert(
            Balance(Global.current_application_address()) >= (claim_amount),
            comment="Insufficient contract balance for claim and fees"
        ),
        Assert(
            Balance(Global.current_application_address()) >= MIN_BALANCE,
            comment="Contract must maintain minimum balance"
        ),
        Assert(
            Txn.rekey_to() == Global.zero_address(),
            comment="Rekey operations not allowed"
        ),
        Assert(
            Txn.close_remainder_to() == Global.zero_address(),
            comment="Account close operations not allowed"
        ),
        Assert(
            Txn.asset_close_to() == Global.zero_address(),
            comment="Asset close operations not allowed"
        )
    ])

@Subroutine(TealType.none)
def send_algo_payment(claim_amount: Expr) -> Expr:
    return Seq([
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver: target_account(),
            TxnField.amount: claim_amount,
            TxnField.fee: Int(0)  
        }),
        InnerTxnBuilder.Submit()
    ])

@Subroutine(TealType.none)
def delete_box() -> Expr:
    box_name = Txn.application_args[1]
    return Seq([
        Assert(Txn.application_args.length() >= Int(2), comment="Box name (address) required"),
        Assert(Len(box_name) == Int(32), comment="Box name must be 32-byte address"),
        check_payment_in_group(CONFIG_FEE, DELETE_LSIG_ADDR),
        box_len := BoxLen(box_name),
        Assert(box_len.hasValue(), comment="Box does not exist"),
        Pop(BoxDelete(box_name))
    ])

@Subroutine(TealType.none)
def clean() -> Expr:
    num_args = Txn.application_args.length()
    return Seq([
        Assert(Txn.sender() == Global.creator_address(), comment="Only contract creator can delete boxes"),
        Assert(num_args >= Int(2), comment="At least one box name required"),
        If(num_args >= Int(2)).Then(Seq([box_len1 := BoxLen(Txn.application_args[1]), Assert(box_len1.hasValue(), comment="Box[1] does not exist"), Pop(BoxDelete(Txn.application_args[1]))])),
        If(num_args >= Int(3)).Then(Seq([box_len2 := BoxLen(Txn.application_args[2]), Assert(box_len2.hasValue(), comment="Box[2] does not exist"), Pop(BoxDelete(Txn.application_args[2]))])),
        If(num_args >= Int(4)).Then(Seq([box_len3 := BoxLen(Txn.application_args[3]), Assert(box_len3.hasValue(), comment="Box[3] does not exist"), Pop(BoxDelete(Txn.application_args[3]))])),
        If(num_args >= Int(5)).Then(Seq([box_len4 := BoxLen(Txn.application_args[4]), Assert(box_len4.hasValue(), comment="Box[4] does not exist"), Pop(BoxDelete(Txn.application_args[4]))])),
        If(num_args >= Int(6)).Then(Seq([box_len5 := BoxLen(Txn.application_args[5]), Assert(box_len5.hasValue(), comment="Box[5] does not exist"), Pop(BoxDelete(Txn.application_args[5]))])),
        If(num_args >= Int(7)).Then(Seq([box_len6 := BoxLen(Txn.application_args[6]), Assert(box_len6.hasValue(), comment="Box[6] does not exist"), Pop(BoxDelete(Txn.application_args[6]))])),
        If(num_args >= Int(8)).Then(Seq([box_len7 := BoxLen(Txn.application_args[7]), Assert(box_len7.hasValue(), comment="Box[7] does not exist"), Pop(BoxDelete(Txn.application_args[7]))])),
        If(num_args >= Int(9)).Then(Seq([box_len8 := BoxLen(Txn.application_args[8]), Assert(box_len8.hasValue(), comment="Box[8] does not exist"), Pop(BoxDelete(Txn.application_args[8]))])),
    ])

@Subroutine(TealType.none)
def set_amount() -> Expr:
    new_amt = Btoi(Txn.application_args[1])
    return Seq([
        Assert(Txn.application_args.length() >= Int(2), comment="Amount value required"),
        check_payment_in_group(CONFIG_FEE, Global.current_application_address()),
        Assert(
            Or(
                new_amt == Int(1_000),
                new_amt == Int(2_000),
                new_amt == Int(4_000),
                new_amt == Int(8_000),
            ),
            comment="Allowed amounts: 1000, 2000, 4000, 8000 microAlgos"
        ),
        App.globalPut(KEY_CLAIM_AMOUNT, new_amt),
    ])

@Subroutine(TealType.none)
def set_interv() -> Expr:
    new_interval = Btoi(Txn.application_args[1])
    return Seq([
        Assert(Txn.application_args.length() >= Int(2), comment="Interval value required"),
        check_payment_in_group(CONFIG_FEE, Global.creator_address()),
        Assert(
            Or(
                new_interval == Int(5_000),
                new_interval == Int(10_000),
                new_interval == Int(20_000),
                new_interval == Int(40_000),
            ),
            comment="Allowed intervals: 5000, 10000, 20000, 40000 blocks"
        ),
        App.globalPut(KEY_BLOCK_INTERVAL, new_interval),
    ])

@Subroutine(TealType.none)
def creator_withdraw() -> Expr:
    amount = Btoi(Txn.application_args[1])
    return Seq([
        Assert(Txn.sender() == Global.creator_address(), comment="Only creator can withdraw"),
        Assert(Txn.application_args.length() >= Int(2), comment="Amount argument required"),
        Assert(
            Balance(Global.current_application_address()) >= (amount + MIN_BALANCE),
            comment="Insufficient balance for withdrawal"
        ),
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver: Txn.sender(),
            TxnField.amount: amount,
            TxnField.fee: Int(0),
        }),
        InnerTxnBuilder.Submit(),
        Approve()
    ])

@Subroutine(TealType.uint64)
def get_claim_amount() -> Expr:
    return If(
        App.globalGet(KEY_CLAIM_AMOUNT) == Int(0),
        CLAIM_AMOUNT_DEFAULT,
        App.globalGet(KEY_CLAIM_AMOUNT),
    )

@Subroutine(TealType.uint64)
def get_block_interval() -> Expr:
    return If(
        App.globalGet(KEY_BLOCK_INTERVAL) == Int(0),
        BLOCK_INTERVAL_DEFAULT,
        App.globalGet(KEY_BLOCK_INTERVAL),
    )

@Subroutine(TealType.none)
def claim() -> Expr:
    last_claim_block = ScratchVar(TealType.uint64)
    is_first_claim = ScratchVar(TealType.uint64)
    is_block_interval_ok = ScratchVar(TealType.uint64)
    block_interval = ScratchVar(TealType.uint64)

    return Seq([
        block_interval.store(get_block_interval()),
        check_and_create_box(),
        last_claim_block.store(get_last_claim_block()),
        is_first_claim.store(last_claim_block.load() == Int(0)),
        is_block_interval_ok.store(Txn.first_valid() >= last_claim_block.load() + block_interval.load()),
        verify_claim_conditions(get_claim_amount()),
        If(is_first_claim.load()).Then(
            Seq([])
        ).Else(
            Assert(is_block_interval_ok.load() == Int(1), comment="Must wait required blocks between claims")
        ),
        send_algo_payment(get_claim_amount()),
        update_last_claim_block()
    ])

def approval_program() -> Expr:
    handle_creation = Seq([
        App.globalPut(KEY_CLAIM_AMOUNT, CLAIM_AMOUNT_DEFAULT),
        App.globalPut(KEY_BLOCK_INTERVAL, BLOCK_INTERVAL_DEFAULT),
        Return(Int(1)),
    ])

    on_call = Seq([
        Cond(
            [Txn.application_args[0] == Bytes("claim"), claim()],
            [Txn.application_args[0] == Bytes("delete"), delete_box()],
            [Txn.application_args[0] == Bytes("clean"), clean()],
            [Txn.application_args[0] == Bytes("amount"), set_amount()],
            [Txn.application_args[0] == Bytes("interv"), set_interv()],
            [Txn.application_args[0] == Bytes("withdraw"), creator_withdraw()],
        ),
        Return(Int(1))
    ])

    only_creator = Txn.sender() == Global.creator_address()

    return Cond(
        [Txn.application_id() == Int(0), handle_creation],
        [Txn.on_completion() == OnComplete.DeleteApplication, Return(only_creator)],
        [Txn.on_completion() == OnComplete.UpdateApplication, Return(only_creator)],
        [Txn.on_completion() == OnComplete.CloseOut, Return(Int(1))],
        [Txn.on_completion() == OnComplete.OptIn, Return(Int(1))],
        [Txn.on_completion() == OnComplete.NoOp, on_call],
    )

def clear_state_program() -> Expr:
    return Approve() 
